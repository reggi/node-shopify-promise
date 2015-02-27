var _ = require("underscore")
var Shopify = require("./index")

var shopify = new Shopify({
  "shop": process.env.SHOP,
  "password": process.env.PASS,
})

var templateSuffixes = function(shopify){
  return shopify.retrieveAllPages().then(function(pages){
    var pagesTemplateSuffix = _.chain(pages)
      .map(function(page){
          return page.template_suffix
      })
      .without("", null, false)
      .map(function(template_suffix){
        return "page."+template_suffix+".liquid"
      }).value()
    return shopify.retrieveAllProducts().then(function(products){
      var productsTemplateSuffix = _.chain(products)
        .map(function(product){
            return product.template_suffix
        })
        .without("", null, false)
        .map(function(template_suffix){
          return "product."+template_suffix+".liquid"
        }).value()
      var AllTemplateSuffix = _.union(productsTemplateSuffix, pagesTemplateSuffix)
      return _.uniq(AllTemplateSuffix)
    })
  })
}

templateSuffixes(shopify).then(function(suffixes){
  console.log(suffixes)
})
