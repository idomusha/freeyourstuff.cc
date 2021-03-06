'use strict';

// Routes for handling API requests

// External dependencies
const router = require('koa-route');

// Internal dependnecies
const SiteSet = require('../models/siteset');
const User = require('../models/user');
const Upload = require('../models/upload');

module.exports = {
  nameCheck: router.get('/api/name', function* get(next) {
    if (!this.request.query.name) {
      this.body = {
        apiError: 'Must specify a username with ?name= parameter'
      };
      return yield next;
    }
    let user = yield User.findOne({
      'local.username': this.request.query.name.toUpperCase()
    });
    if (user)
      this.body = {
        userExists: user.local.displayName
      };
    else
      this.body = {
        userExists: false
      };
    return yield next;
  }),

  loginStatus: router.get('/api/loginstatus', function* get(next) {
    if (!this.isAuthenticated()) {
      this.body = {
        loggedIn: false
      };
    } else {
      this.body = {
        loggedIn: true,
        id: this.req.user._id,
        displayName: this.req.user[this.session.method].displayName,
        method: this.session.method
      };
    }
    return yield next;
  }),

  trust_POST: router.post('/api/trust', function* post(next) {
    if (!this.isAuthenticated()) {
      this.body = {
        error: 'You must be signed in to review datasets.'
      };
      this.status = 401;
      return yield next;
    }
    if (!this.req.user.canModerate()) {
      this.body = {
        error: 'You do not have the required user rights to perform this action.'
      };
      this.status = 401;
      return yield next;
    }
    if (!this.request.body || !this.request.body.uploadID || typeof this.request.body.uploadID !== 'string') {
      this.body = {
        error: 'You did not specify a valid upload ID.'
      };
      this.status = 400;
      return yield next;
    }
    let foundUpload;
    try {
      foundUpload = yield Upload.findOneAndUpdate({
        _id: this.request.body.uploadID
      }, {
        $set: {
          isTrusted: true,
          trustedDate: new Date(),
          trustedBy: this.req.user._id
        }
      });
    } catch (e) {
      this.body = {
        error: 'An error occurred when attempting to mark this upload as trusted.'
      };
      this.status = 500;
      console.error('Error with attempt to mark upload as trusted.');
      console.error(e);
      return yield next;
    }
    this.body = {
      message: 'Hooray! Thanks for your help reviewing datasets.'
    };
    this.status = 200;
    return yield next;
  }),

  siteSet_POST: router.post('/api/siteset', function* post(next) {
    if (!apiSignedIn(this))
      return yield next;

    let c = this.request.body;

    if (!apiValidateSiteSet(this, c))
      return yield next;

    let upload = new Upload();

    if (SiteSet.hasOwnProperty(c.schemaKey)) {
      let siteSet = new SiteSet[c.schemaKey]();
      upload.uploadDate = new Date();
      upload.uploader = this.req.user._id;
      upload.schemaKey = c.schemaKey;
      upload.siteSet = siteSet._id;
      upload.isTestUpload = this.req.user.isTester ? true : false;

      // We store the version, but not the key of the schema.
      // The key is already implicitly stored through the MongoDB collection name.
      if (c.schemaVersion !== undefined)
        siteSet.schemaVersion = c.schemaVersion;

      if (c.license !== undefined)
        siteSet.license = c.license;

      // Loop through datasets in this siteset, add them to our DB collection.
      // Abort if we encounter invalid data.
      for (let d in c) {
        if (d == 'schemaKey' || d == 'schemaVersion' || d == 'license')
          continue;
        if (!apiValidateDataset(this, c[d]))
          return yield next;

        siteSet[d] = c[d];

        // Keep track of # of records for upload log
        if (siteSet[d].data && siteSet[d].data.length) {
          if (upload.number === undefined)
            upload.number = {};
          upload.number[d] = siteSet[d].data.length;
        }

      }

      // Attempt to save the data to MongoDB
      try {
        yield siteSet.save();
      } catch (e) {
        apiDBError(this, e);
        return yield next;
      }
      apiReportSuccess(this);
      upload
        .save()
        .catch(error => {
          console.error('Problem saving to upload log.');
          console.error(error);
        });
      return yield next;
    } else {
      this.body = {
        error: 'Unknown schema: ' + c.schemaKey
      };
      this.status = 400;
      return yield next;
    }
  })

};

function apiSignedIn(ctx) {
  if (!ctx.isAuthenticated()) {
    ctx.body = {
      error: 'You must be signed in to upload documents.'
    };
    ctx.status = 401;
    return false;
  }
  return true;
}

function apiDBError(ctx, error) {
  if (error.name === 'ValidationError') {
    ctx.body = {
      error: 'Data did not match the expected schema.'
    };
    ctx.status = 400;
  } else {
    ctx.body = {
      error: 'Unknown problem saving/parsing the data. Could be an issue on our end. Sorry! :('
    };
    ctx.status = 500;
  }
}

function apiValidateSiteSet(ctx, siteSet) {
  if (!siteSet.schemaVersion || !siteSet.schemaKey) {
    ctx.body = {
      error: 'Not a valid schema, must have a schemaVersion and schemaKey.'
    };
    ctx.status = 400;
    return false;
  }
  return true;
}

function apiValidateDataset(ctx, dataset) {
  if (!dataset.data || !dataset.head || typeof dataset.head !== 'object' ||
    !Array.isArray(dataset.data)) {
    ctx.body = {
      error: 'Not a valid dataset, must have a head object and data array.'
    };
    ctx.status = 400;
    return false;
  } else
    return true;
}

function apiReportSuccess(ctx) {
  ctx.body = {
    message: 'Thank you for your contribution. You have made a simple API very happy.'
  };
  ctx.status = 200;
}
