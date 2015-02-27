# Shopify API

## Why

I wanted a Shopify wrapper that used promises.

## Features

 * Bluebird promises
 * Rate limit handling

## Usage

```
var Shopify = require("./shopify");

var shopify = new Shopify({
 "shop": "SHOP.myshopify.com",
 "password": PASSWORD,
}

shopify.retrieveBlogs().then(function(blogs){

})
```
