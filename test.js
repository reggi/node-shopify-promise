var Shopify = require("./index")

var shopify = new Shopify({
  "shop": process.env.SHOP,
  "password": process.env.PASS,
})

shopify.retrieveBlogs().then(function(blogs){
  console.log(blogs)
})
