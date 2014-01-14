var util = require('util');
var request = require('superagent'),
  defer = require('node-promise').defer,
  qs = require('qs');

module.exports = function (apiKey, options) {
  var apiKey = apiKey || process.env.FILEPICKER_API_KEY,
    apiRoot = options && options.api ? options.api : 'https://www.filepicker.io/api',
    rootREGEX = /http/,
    augmentQuery = function (query) {
      if (!query) {
        query = {};
      }
      query.key = apiKey;
      query._cacheBust = Math.round(Math.random() * 100000);
      return qs.stringify(query);
    },
    augmentPath= function (path) {
      if (!path.match(rootREGEX)) {
        return apiRoot + path;
      }
      return path;
    },
    verbs = {
      get: function (path, query, options) {
        if (options && options.buffer) {
          return request.get(augmentPath(path) + "?" + augmentQuery(query)).buffer();
        }
        else {
          return request.get(augmentPath(path) + "?" + augmentQuery(query));
        }
      },
      post: function (path, query) {
        return request.post(augmentPath(path) + "?" + augmentQuery(query)).set('Content-Type', 'application/json');
      }
    },
    callback = function (localDeferred, localCallback) {
      return function (response) {
        var err = response.error,
          res = response;
        if (err) {
          localDeferred.reject(err);
        } else {
          localDeferred.resolve(res.text || res.data || res);
        }
        if (typeof localCallback === 'function') {
          localCallback(err, res);
        }
      }
    };

  if (!apiKey) {
    throw new Error('Filepicker API key is missing. Either add it during construction... new Filepicker("MYAPIKEY", options)... or have it available as an environment variable at FILEPICKER_API_KEY');
  }

  return {
    read: function (inkBlob, query, cb) {
      if (typeof query === 'function') {
        cb = query;
        query = undefined;
      }

      var deferred = defer(),
        done = callback(deferred, cb);

      if (!inkBlob || !inkBlob.url) {
        done('inkBlob.url missing');
      } else {
        if (!query) {
          query = {base64encode: true}; // Default query to base64encode
        }
        verbs.get(inkBlob.url, query)
          .set('X-NO-STREAM', true)
          .set('connection', 'keep-alive')
          .set('Accept-Encoding', 'gzip,deflate,sdch')
          .set('Accept', 'text/javascript, text/html, application/xml, text/xml, */*')
          .parse(function (res, callback) {
            res.text = '';
            res.on('data', function (data) {
              res.text += data;
            });
            res.on('end', function () {
              done(new Buffer(res.text));
            });
          })
          .end(function (err, res) {
            //Don't do jack... the callback is handled in the parse
        });

      }
      return deferred.promise;

    },
    stat: function (inkBlob, query, cb) {
      if (typeof query === 'function') {
        cb = query;
        query = undefined;
      }
      var deferred = defer(),
        done = callback(deferred, cb);

      if (!inkBlob || !inkBlob.url) {
        done('inkBlob.url missing');
      } else {
        var metaUrl = inkBlob.url + '/metadata';
        // console.log('Requesting meta data - ' + metaUrl);
        verbs.get(metaUrl, query).end(function (err, res) {
          // console.log('Got meta data - ' + res.text);
          var metadata = JSON.parse(res.text);
          metadata.url = inkBlob.url;

          if (typeof cb === 'function') {
            done(err, metadata);
          } else if (err) {
            done({error: err});
          } else {
            done(metadata);
          }

        });
      }
      return deferred.promise;

    },
    write: function () {
    },
    store: function (payload, filename, mimetype, query, cb) {
      var deferred = defer(),
        done = callback(deferred, cb);
      if (!payload) {
        done('payload missing');
      } else if (!filename) {
        done('filename missing');
      } else if (!mimetype) {
        done('mimetype missing');
      } else {
        if (!query) {
          query = {};
        }
        query.mimetype = mimetype;
        query.filename = filename;
        query.base64decode = true;
        verbs.post('/store/S3', query).send(payload).end(done);
      }

      return deferred.promise;

    },
    remove: function (inkBlob, cb) {
      var deferred = defer(),
        done = callback(deferred, cb);

      if (!inkBlob || !inkBlob.url) {
        done('inkBlob.url missing');
      } else {
        verbs.post(inkBlob.url + '/remove').send({key: apiKey}).end(done);
      }
      return deferred.promise;

    },
    //
    // convert: Convert, given a w or h, ie:
    //
    //   'https://www.filepicker.io/api/file/66RPf0ITT0NKMAvHUUpA/convert?w=300'
    //
    convert: function(inkBlob, query, cb) {
      // console.log('convert: blob - ' + JSON.stringify(inkBlob));
      var deferred = defer(),
        done = callback(deferred, cb);
      if (!inkBlob || !inkBlob.url) {
        done('inkBlob.url missing');
      } else {
        var convertUrl = inkBlob.url + '/convert';
        // console.log('Requesting thumbnail - ' + convertUrl);
        var resHeaders = undefined;
        verbs.get(convertUrl, query).parse(function(res, callback) {
          var data = [];

          res.on('data', function(chunk) {
            // console.log('Got chunk of length - ' + chunk.length);
            data.push(chunk);
          });
          res.on('end', function() {
            var err = null;
            var buffer = Buffer.concat(data);

            // console.log('Have buffer of length - ' + buffer.length);

            if (typeof cb === 'function') {
              done(err, 
                   {
                     headers: resHeaders,
                     payload: buffer
                   });
            } else if (err) {
              done({error: err});
            } else {
              // console.log('Return buffer as payload, res headers - ' + util.inspect(resHeaders) + ', content length - ' + resHeaders['content-length']);
              done({
                headers: resHeaders,
                payload: buffer
              });
            }
          });
        }).end(function (err, res) {
          // console.log('Request end, content length - ' + res.header['content-length']);
          resHeaders = res.header;
        });
      }
      return deferred.promise;
    }
  };
};
