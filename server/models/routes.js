let mongoose = require('mongoose');

// create schema model for GTFS trip list
let routeModel = new mongoose.Schema({
    route_long_name: String,
    route_url: String,
    route_color: String,
    route_type: String,
    route_short_name: String,
    route_id: String,
    route_desc: String,
    route_text_color: String,
    agency_id: String,
},
    {
        collection:"routes"
    });
module.exports = mongoose.model('routes', routeModel);