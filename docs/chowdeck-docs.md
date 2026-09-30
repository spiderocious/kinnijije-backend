find a location

https://api.chowdeck.com/place/autocomplete/json?input={location}

returns

{
  "predictions": [
    {
      "description": "Lagos, Nigeria",
      "matched_substrings": [
        {
          "length": 1,
          "offset": 0
        }
      ],
      "place_id": "14350144",
      "reference": "14350144",
      "structured_formatting": {
        "main_text": "Lagos",
        "main_text_matched_substrings": [
          {
            "length": 1,
            "offset": 0
          }
        ],
        "secondary_text": "Lagos, Nigeria"
      },
      "terms": [],
      "types": [
        "locality",
        "political",
        "geocode"
      ]
    }
  ],
  "status": "OK"
}

the goal for the location will be that we compute all the major cities in nigeria, and would've gotten the response above and then keep in db.

so that when user searches for locaiton, we return the ones we got, and for interactions with chowdeck api, we then use the details we saved.

https://api.chowdeck.com/customer/search/product?address_id=14036726&type=restaurant&query=tuwo
response written to: backend/docs/restaurant-api.response.json

the query key is the food

like query=(food)

this enables us to just show them restaurants that have the food they are looking for.

we can make do with this for now

but how we can we optimize this, so response dont get delayed for this
and we can have buy on chowdeck 
then the list of meals

then a click takes them to  chowdeck to complete the order.
mostly the redirection will be:

either to the restautrant page:
https://chowdeck.com/store/ijesha-tedo/restaurants/tuwo-best-bankolemohijesha-tedotn6s3d 
so we more like redirect to the restaurant page. 