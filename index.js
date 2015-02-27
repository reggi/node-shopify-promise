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
  this.debug = (options.debug) ? options.debug : false;
  this.shop = options.shop
  this.password = options.password
  this.cache = {}
  this.req = (this.debug) ? this.mockRequest : this.makeRequest;
  // allows for 40 request a second
  // http://docs.shopify.com/api/introduction/api-call-limit
  // 1000 / 40, 500, 20
  this.request = promiseDebounce(this.req, 1000, 2)
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

/* -----BLOGS----- */

Shopify.prototype.retrieveBlogs = function() {
  return this.request({
    "path": "/admin/blogs.json",
  });
}

Shopify.prototype.findBlog = function(match) {
  return this.retrieveBlogs().then(function(response) {
    return response.blogs;
  }).then(_).call("findWhere", match).then(function(blog) {
    return {
      "blog": blog
    }
  });
}

Shopify.prototype.createBlog = function(blogContent) {
  return this.request({
    "method": "POST",
    "path": "/admin/blogs.json",
    "body": {
      "blog": blogContent
    }
  });
}

Shopify.prototype.deleteBlog = function(blogId) {
  return this.request({
    "method": "DELETE",
    "path": "/admin/blogs/" + blogId + ".json",
  });
}

Shopify.prototype.ensureBlog = function(match, blogContent) {
  if (typeof blogContent == "undefined") blogContent = match;
  return this.findBlog(match).then(function(response) {
    if (response.blog) return response;
    return this.createBlog(blogContent).then(function(response) {
      return response;
    });
  }.bind(this));
}

/* -----ARTICLES----- */

Shopify.prototype.retrieveArticles = function(blogId) {
  return this.request({
    "path": "/admin/blogs/" + blogId + "/articles.json",
  });
}

Shopify.prototype.retrieveArticle = function(blogId, articleId) {
  return this.request({
    "path": "/admin/blogs/" + blogId + "/articles/" + articleId + ".json"
  });
}

Shopify.prototype.findArticle = function(articlesResponse, match) {
  return Promise.resolve(articlesResponse).then(function(response) {
    return response.articles;
  }).then(_).call("findWhere", match).then(function(article) {
    return {
      "article": article
    }
  });
}

Shopify.prototype.createArticle = function(blogId, articleContent) {
  return this.request({
    "method": "POST",
    "path": "/admin/blogs/" + blogId + "/articles.json",
    "body": {
      "article": articleContent
    }
  });
}

Shopify.prototype.getMetafieldsToUpdate = function(serverContent, articleContent) {
  var serverMetafields = _.indexBy(serverContent.metafields, "key");
  var localMetafields = _.indexBy(articleContent.metafields, "key");
  return _.chain(localMetafields).map(function(localMetafield, key) {
    if (!serverMetafields[key]) return false;
    var serverMetafield = serverMetafields[key];
    var sameNamespace = serverMetafield.namespace === localMetafield.namespace;
    var sameValue = serverMetafield.value === localMetafield.value;
    if (sameNamespace && sameValue) return false;
    return _.extend(serverMetafield, localMetafield);
  }).compact().value();
}

Shopify.prototype.getMetafieldsToDelete = function(serverContent, articleContent) {
  var serverMetafields = _.indexBy(serverContent.metafields, "key");
  var localMetafields = _.indexBy(articleContent.metafields, "key");
  return _.chain(serverMetafields).map(function(serverMetafield, key) {
    if (!localMetafields[key]) return serverMetafield;
    return false;
  }).compact().value();
}

Shopify.prototype.getMetafieldsToCreate = function(serverContent, articleContent) {
  var serverMetafields = _.indexBy(serverContent.metafields, "key");
  var localMetafields = _.indexBy(articleContent.metafields, "key");
  return _.chain(localMetafields).map(function(localMetafield, key) {
    if (!serverMetafields[key]) return localMetafield;
    return false;
  }).compact().value();
}

Shopify.prototype.updateArticleAndMetafields = function(blogId, articleId, articleContent) {
  return this.retrieveTypeMetafields("articles", articleId).then(function(response) {
    var metafieldsToCreate = this.getMetafieldsToCreate(response, articleContent);
    var metafieldsToUpdate = this.getMetafieldsToUpdate(response, articleContent);
    var metafieldsToDelete = this.getMetafieldsToDelete(response, articleContent);
    //debug(metafieldsToCreate);
    //debug(metafieldsToUpdate);
    //debug(metafieldsToDelete);
    articleContent.metafields = metafieldsToCreate;
    return this.updateArticle(blogId, articleId, articleContent)
      .then(function() {
        return this.deleteTypeMetafields("articles", articleId, metafieldsToDelete);
      }.bind(this))
      .then(function() {
        return this.updateTypeMetafields("articles", articleId, metafieldsToUpdate);
      }.bind(this))
  }.bind(this));
}

Shopify.prototype.updateArticle = function(blogId, articleId, articleContent) {
  return this.request({
    "method": "PUT",
    "path": "/admin/blogs/" + blogId + "/articles/" + articleId + ".json",
    "body": {
      "article": articleContent
    }
  });
}

Shopify.prototype.deleteArticle = function(blogId, articleId) {
  return this.request({
    "method": "DELETE",
    "path": "/admin/blogs/" + blogId + "/articles/" + articleId + ".json",
  });
}

Shopify.prototype.ensureArticle = function(articlesResponse, blogId, match, articleContent) {
  return this.findArticle(articlesResponse, match).then(function(response) {
    if (dotty.exists(response, "article.id")) {
      var articleId = response.article.id;
      return this.updateArticleAndMetafields(blogId, articleId, articleContent)
        .then(function(response) {
          return response;
        });
    } else {
      return this.createArticle(blogId, articleContent).then(function(response) {
        return response;
      });
    }
  }.bind(this));
}

Shopify.prototype.ensureArticles = function(articlesResponse, blogId, match, articles) {
  return Promise.each(articles, function(article) {
    var _match = (typeof match == "function") ? match(article) : match;
    return this.ensureArticle(articlesResponse, blogId, _match, article);
  }.bind(this));
}

/* -----METAFIELDS----- */

Shopify.prototype.retrieveTypeMetafields = function(type, typeId) {
  return this.request({
    "path": "/admin/" + type + "/" + typeId + "/metafields.json"
  });
}

Shopify.prototype.updateTypeMetafield = function(type, typeId, metafieldsId, metafieldContent) {
  return this.request({
    "method": "PUT",
    "path": "/admin/" + type + "/" + typeId + "/metafields/" + metafieldsId + ".json",
    "body": {
      "metafield": metafieldContent
    }
  });
}

Shopify.prototype.createTypeMetafield = function(type, typeId, metafieldContent) {
  return this.request({
    "method": "POST",
    "path": "/admin/" + type + "/" + typeId + "/metafields.json",
    "body": {
      "metafield": metafieldContent
    }
  });
}

Shopify.prototype.deleteTypeMetafield = function(type, typeId, metafieldsId) {
  return this.request({
    "method": "DELETE",
    "path": "/admin/" + type + "/" + typeId + "/metafields/" + metafieldsId + ".json",
  });
}

Shopify.prototype.updateTypeMetafields = function(type, typeId, metafields) {
  return Promise.each(metafields, function(metafield) {
    return this.updateTypeMetafield(type, typeId, metafield.id, metafield);
  }.bind(this));
}

Shopify.prototype.deleteTypeMetafields = function(type, typeId, metafields) {
  return Promise.each(metafields, function(metafield) {
    return this.deleteTypeMetafield(type, typeId, metafield.id);
  }.bind(this));
}

/* -----REDIRECTS----- */

Shopify.prototype.retrieveRedirects = function(page){
  if(!page) page = 1;
  return this.request({
    "path": "/admin/redirects.json",
    "qs": {
      "limit": 250,
      "page": page
    }
  }).then(function(response){
    return response.redirects
  });
}

Shopify.prototype.retrieveRedirectsCount = function(){
  return this.request({
    "path": "/admin/redirects/count.json"
  }).then(function(response){
    return response.count;
  })
}

Shopify.prototype.retrieveAllRedirects = function(){
  return this.retrieveRedirectsCount().then(function(count){
    var pages = Math.ceil(count / 250)
    var range = _.range(1, pages+1)
    return range
  }).map(function(page){
    return this.retrieveRedirects(page)
  }.bind(this)).then(_).call("flatten")
}

Shopify.prototype.createRedirect = function(redirectContent) {
  return this.request({
    "method": "POST",
    "path": "/admin/redirects.json",
    "body": {
      "redirect": redirectContent
    }
  });
}

Shopify.prototype.updateRedirect = function(redirectId, redirectContent) {
  redirectContent.id = redirectId
  return this.request({
    "method": "PUT",
    "path": "/admin/redirects/"+ redirectId +".json",
    "body": {
      "redirect": redirectContent
    }
  });
}

Shopify.prototype.ensureRedirects = function(redirects){
  return this.retrieveAllRedirects().then(function(existingRedirects){
    return Promise.map(redirects, function(redirect){
      return Promise.resolve(existingRedirects).then(_).call("findWhere", {
        "path": redirect.path,
      }).then(function(match){
        if(match && match.url == redirect.url) return match
        if(match) return this.updateRedirect(match.id, redirect)
        return this.createRedirect(redirect)
      }.bind(this))
    }.bind(this))
  }.bind(this))
}
