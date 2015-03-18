var path = require("path")
var dotty = require("dotty");
var Promise = require("bluebird");
var debug = require("debug")("shopify");
var request = require("request-promise")
var url = require("url");
var _ = require("underscore");
var fs = Promise.promisifyAll(require("fs"))
var promiseDebounce = require("./promise-debounce")

module.exports = Shopify;

function Shopify(options) {
  this.debug = options.debug || false;
  this.shop = options.shop
  this.password = options.password
  this.cache = {}
  this.requestsPerSecond = options.requestsPerSecond || 2
  this.req = (this.debug) ? this.mockRequest : this.makeRequest;
  // allows for 40 request a second
  // http://docs.shopify.com/api/introduction/api-call-limit
  // 1000 / 40, 500, 20
  this.request = promiseDebounce(this.req, 1000, this.requestsPerSecond)
  debug("shop %s", this.shop);
}

Shopify.prototype.mockRequest = function(options) {
  debug("mock %s %s", options.method, options.path.replace(/\/admin|\.json/ig, ""));
  return Promise.delay(Math.random() * _.random(100, 999));
}

Shopify.prototype.makeRequest = function(options) {
  var defaults = {
    "method": "GET",
    "json": true,
    "headers": {
      "X-Shopify-Access-Token": this.password
    }
  };
  if (options.path) defaults["url"] = "https://" + this.shop + options.path;
  options = _.defaults(options, defaults);
  debug("%s %s", options.method, options.path.replace(/\/admin|\.json/ig, ""));
  return request(options);
}

function retrieveAllRange(count){
  var pages = Math.ceil(count / 250)
  var range = _.range(1, pages+1)
  return range
}

function instantiateAsset(schema){
  var asset = {}
  asset.schema = schema
  asset.parent = _.first(schema)
  if(asset.schema.length !== 1) asset.child = _.last(schema)
  asset.alias = _.last(asset.schema)
  if(asset.child && asset.child.lowercaseSingular == "metafield"){
    asset.alias["uppercasePlural"] = asset.parent.uppercaseSingular + "Metafields"
    asset.alias["uppercaseSingular"] = asset.parent.uppercaseSingular + "Metafield"
  }
  return asset;
}

function assembleUrl(asset, parentId, childId){
  var theUrl = []
  theUrl.push("admin")
  theUrl.push(asset.parent.lowercasePlural)
  if(parentId){
    parentId = parentId.toString()
    theUrl.push(parentId)
  }
  if(asset.child){
    theUrl.push(asset.child.lowercasePlural)
  }
  if(childId){
    childId = childId.toString()
    theUrl.push(childId)
  }
  theUrl = path.join.apply(false, theUrl)
  theUrl = "/"+theUrl
  return theUrl
}


function indexByMultiple(collection, indexByArray, delimeter){
  if(!delimeter) delimeter = " "
  var arrObject = _.map(collection, function(item){
    var ids = _.map(indexByArray, function(value){
      return item[value]
    })
    var temp = {}
    temp[ids.join(delimeter)] = item
    return temp
  })
  return _.extend.apply(null, [{}].concat(arrObject));
}

function indexByMetafield(collection){
  return indexByMultiple(collection, ["namespace", "key"], ".")
}

function getMetafieldsToCreate(serverContent, articleContent) {
  var serverMetafields = indexByMetafield(serverContent.metafields)
  var localMetafields = indexByMetafield(articleContent.metafields)
  return _.chain(localMetafields).map(function(localMetafield, key) {
    if (!serverMetafields[key]) return localMetafield;
    return false;
  }).compact().value();
}

function getMetafieldsToUpdate(serverContent, articleContent) {
  var serverMetafields = indexByMetafield(serverContent.metafields)
  var localMetafields = indexByMetafield(articleContent.metafields)
  return _.chain(localMetafields).map(function(localMetafield, key) {
    if (!serverMetafields[key]) return false;
    var serverMetafield = serverMetafields[key];
    var sameNamespace = serverMetafield.namespace === localMetafield.namespace;
    var sameValue = serverMetafield.value === localMetafield.value;
    if (sameNamespace && sameValue) return false;
    return _.extend(serverMetafield, localMetafield);
  }).compact().value();
}

function getMetafieldsToDelete(serverContent, articleContent) {
  var serverMetafields = indexByMetafield(serverContent.metafields)
  var localMetafields = indexByMetafield(articleContent.metafields)
  return _.chain(serverMetafields).map(function(serverMetafield, key) {
    if (!localMetafields[key]) return serverMetafield;
    return false;
  }).compact().value();
}

/* -----skeleton----- */

Shopify.prototype.retrievePlural = function(asset, page, parentId) {
  if(!page) page = 1;
  var theUrl = assembleUrl(asset, parentId)+".json"
  return this.request({
    "path": theUrl,
    "qs": {
      "limit": 250,
      "page": page
    }
  }).then(function(response){
    return response[_.last(asset.schema).lowercasePlural]
  })
}

Shopify.prototype.retrieveSingular = function(asset, parentId, childId) {
  var theUrl = assembleUrl(asset, parentId, childId)+".json"
  return this.request({
    "path": theUrl
  }).then(function(response){
    //metafields returns plural if it's the child
    if(asset.child.lowercasePlural == "metafields"){
      return response[_.last(asset.schema).lowercasePlural]
    }
    return response[_.last(asset.schema).lowercaseSingular]
  })
}

Shopify.prototype.retrieveCount = function(asset, parentId){
  var theUrl = assembleUrl(asset, parentId)+"/count.json"
  return this.request({
    "path": theUrl
  }).then(function(response){
    return response.count
  })
}

Shopify.prototype.retrieveAll = function(asset, parentId){
  return this.retrieveCount(asset, parentId)
    .then(retrieveAllRange)
    .map(function(page){
      return this.retrievePlural(asset, page, parentId)
    }.bind(this)).then(_).call("flatten")
}

Shopify.prototype.retrieveSingularWithMetafields = function(asset, parentId, childId) {
  return this.retrieveSingular(asset, parentId, childId)
    .then(function(item){
      var parentMetafieldAsset = instantiateAsset([asset.alias, endpoints.metafield])
      return this.retrieveSingular(parentMetafieldAsset, item.id)
        .then(function(metafields){
          item.metafields = metafields
          return item
        })
    }.bind(this))
}

Shopify.prototype.retrieveAllWithMetafields = function(asset, parentId){
  return this.retrieveAll(asset, parentId)
    .map(function(item){
      var parentMetafieldAsset = instantiateAsset([asset.alias, endpoints.metafield])
      return this.retrieveSingular(parentMetafieldAsset, item.id)
        .then(function(metafields){
          item.metafields = metafields
          return item
        })
    }.bind(this))
}

Shopify.prototype.find = function(asset, match, parentId) {
  return this.retrieveAll(asset, parentId)
    .then(_)
    .call("findWhere", match)
}

Shopify.prototype.create = function(asset, content, parentId) {
  var options = {
    "method": "POST",
    "path": assembleUrl(asset, parentId)+".json",
    "body": {}
  };
  options.body[_.last(asset.schema).lowercaseSingular] = content
  return this.request(options).then(function(response){
    return response[_.last(asset.schema).lowercaseSingular]
  })
}

Shopify.prototype.deleteSingular = function(asset, parentId, childId) {
  childId = (typeof childId == "object" && childId.id) ? childId.id : false
  if(!childId) throw new Error("can't delete without id")
  var theUrl = assembleUrl(asset, parentId, childId)+".json"
  return this.request({
    "method": "DELETE",
    "path": theUrl,
  })
}

Shopify.prototype.deletePlural = function(asset, parentId, childIds) {
  if(childIds.length > 0){
    return Promise.each(childIds, function(childId) {
      return this.deleteSingular(asset, parentId, childId);
    }.bind(this));
  }else{
    return [];
  }
}

Shopify.prototype.updateSingular = function(asset, content, parentId, childId) {
  if(content.id) childId = content.id
  if(content.blog_id) parentId = content.blog_id
  var options = {
    "method": "PUT",
    "path": assembleUrl(asset, parentId, childId)+".json",
    "body": {}
  }
  options.body[_.last(asset.schema).lowercaseSingular] = content
  return this.request(options).then(function(response){
    return response[_.last(asset.schema).lowercaseSingular]
  })
}

Shopify.prototype.updatePlural = function(asset, parentId, contents) {
  if(contents.length > 0){
    return Promise.each(contents, function(content) {
      return this.updateSingular(asset, content, parentId);
    }.bind(this));
  }else{
    return [];
  }
}

Shopify.prototype.updateSingularWithMetafields = function(asset, content, parentId, childId) {
  if(content.id) childId = content.id
  if(content.blog_id) parentId = content.blog_id
  var aliasId = (childId) ? childId : parentId;
  if(content.metafields){
    var parentMetafieldAsset = instantiateAsset([asset.alias, endpoints.metafield])
    //get existing metafields for this object
    return this.retrieveSingular(parentMetafieldAsset, aliasId)
      .then(function(metafields){
        var existing = {}
        existing.metafields = metafields
        return existing
      })
      .then(function(existing){
        var metafieldsToCreate = getMetafieldsToCreate(existing, content)
        var metafieldsToUpdate = getMetafieldsToUpdate(existing, content)
        var metafieldsToDelete = getMetafieldsToDelete(existing, content)
        content.metafields = metafieldsToCreate
        return Promise.props({
          // make the request to update with only non-exiting metafields
          "update": this.updateSingular(asset, content, parentId, childId),
          "updateMetafields": this.updatePlural(parentMetafieldAsset, aliasId, metafieldsToUpdate),
          "deleteMetafields": this.deletePlural(parentMetafieldAsset, aliasId, metafieldsToDelete),
        }).then(function(results){
          var update = {}
          update = results.update
          update.results = {
            "updateMetafields": results.updateMetafields,
            "deleteMetafields": results.deleteMetafields
          }
          return update
        })
      }.bind(this))
  }else{
    return this.updateSingular(asset, content, parentId, childId)
  }
}

function dynamicMatch(match, content){
  var temp = {}
  _.each(match, function(critera){
    if(content[critera]) temp[critera] = content[critera]
  })
  return temp;
}

Shopify.prototype.allPossibleExistingObjects = function(asset, contents, parentId){
  if(_.isArray(contents)){
    var parentIds = _.chain(contents).map(function(content){
      if(content.blog_id) return content.blog_id
      return false
    }).without(false).uniq().value()
  }else if(contents && contents.blog_id){
    var parentIds = [contents.blog_id]
  }else{
    var parentIds = []
  }
  if(parentId){
    parentIds.push(parentId)
    parentIds = _.uniq(parentIds)
  }
  if(parentIds.length !== 0){
    return Promise.map(parentIds, function(parentId){
      return this.retrieveAll(asset, parentId)
    }.bind(this)).then(_).call("flatten")
  }else{
    return this.retrieveAll(asset)
  }
}

Shopify.prototype.ensurePluralAndSingular = function(asset, match, contents, parentId){
  return this.allPossibleExistingObjects(asset, contents, parentId).then(function(items){
    if(!contents && match){
      var found = _.findWhere(items, match)
      if(found) return found
      return this.create(asset, match, parentId)
    }
    if(contents && !_.isArray(contents)) contents = [contents]
    return Promise.map(contents, function(content){
      if(content.id) childId = content.id
      if(content.blog_id) parentId = content.blog_id
      var thisMatch = (_.isArray(match)) ? dynamicMatch(match, content) : match
      var found = _.findWhere(items, thisMatch)
      var childId = function(){
        if(parentId && parentId == content.id) return undefined
        if(parentId && parentId == content.id) return content.id
        if(found && parentId == found.id) return undefined
        if(found && parentId !== found.id) return found.id
      }()
      if(!items || !childId || !found) return this.create(asset, content, parentId)
      return this.updateSingularWithMetafields(asset, content, parentId, childId)
    }.bind(this)).then(function(results){
      if(contents && !_.isArray(contents)) return results[0]
      return results
    })
  }.bind(this))
}

/* -----BUILDER----- */

var endpoints = {
  "blog": {
    "uppercasePlural": "Blogs",
    "uppercaseSingular": "Blog",
    "lowercasePlural": "blogs",
    "lowercaseSingular": "blog"
  },
  "redirect": {
    "uppercasePlural": "Redirects",
    "uppercaseSingular": "Redirect",
    "lowercasePlural": "redirects",
    "lowercaseSingular": "redirect"
  },
  "article": {
    "uppercasePlural": "Articles",
    "uppercaseSingular": "Article",
    "lowercasePlural": "articles",
    "lowercaseSingular": "article"
  },
  "metafield": {
    "uppercasePlural": "Metafields",
    "uppercaseSingular": "Metafield",
    "lowercasePlural": "metafields",
    "lowercaseSingular": "metafield"
  }
}

var assets = [
  [endpoints.blog],
  [endpoints.redirect],
  [endpoints.blog, endpoints.article],
  [endpoints.article, endpoints.metafield],
  [endpoints.blog, endpoints.metafield],
]

_.each(assets, function(schema){
  var asset = instantiateAsset(schema)
  var plural = asset.alias.uppercasePlural
  var singular = asset.alias.uppercaseSingular

  var funcName = "retrieve"+plural
  Shopify.prototype[funcName] = function(page, parentId){
    return this.retrievePlural(asset, page, parentId)
  }

  var funcName = "retrieve"+singular
  Shopify.prototype[funcName] = function(parentId, childId){
    return this.retrieveSingular(asset, parentId, childId)
  }

  var funcName = "retrieve"+plural+"Count"
  Shopify.prototype[funcName] = function(parentId){
    return this.retrieveCount(asset, parentId)
  }

  var funcName = "retrieveAll"+plural
  Shopify.prototype[funcName] = function(parentId){
    return this.retrieveAll(asset, parentId)
  }

  var funcName = "retrieve"+singular+"WithMetafields"
  Shopify.prototype[funcName] = function(parentId, childId){
    return this.retrieveSingularWithMetafields(asset, parentId, childId)
  }

  var funcName = "retrieveAll"+plural+"WithMetafields"
  Shopify.prototype[funcName] = function(parentId){
    return this.retrieveAllWithMetafields(asset, parentId)
  }

  var funcName = "find"+singular
  Shopify.prototype[funcName] = function(match, parentId){
    return this.find(asset, match, parentId)
  }

  var funcName = "create"+singular
  Shopify.prototype[funcName] = function(content, parentId){
    return this.create(asset, content, parentId)
  }

  var funcName = "delete"+singular
  Shopify.prototype[funcName] = function(parentId, childId){
    return this.deleteSingular(asset, parentId, childId)
  }

  var funcName = "delete"+plural
  Shopify.prototype[funcName] = function(parentId, childIds){
    return this.deletePlural(asset, parentId, childIds)
  }

  var funcName = "update"+singular
  Shopify.prototype[funcName] = function(content, parentId, childId){
    return this.updateSingular(asset, content, parentId, childId)
  }

  var funcName = "update"+plural
  Shopify.prototype[funcName] = function(parentId, contents){
    return this.updatePlural(asset, parentId, contents)
  }

  var funcName = "update"+singular+"WithMetafields"
  Shopify.prototype[funcName] = function(content, parentId, childId){
    return this.updateSingularWithMetafields(asset, content, parentId, childId)
  }

  var funcName = "ensure"+singular
  Shopify.prototype[funcName] = function(match, content, parentId){
    return this.ensurePluralAndSingular(asset, match, content, parentId)
  }

  var funcName = "ensure"+plural
  Shopify.prototype[funcName] = function(match, content, parentId){
    return this.ensurePluralAndSingular(asset, match, content, parentId)
  }

})
