let mongoose = require('mongoose');

// create schema model for GTFS trip list
let tripModel = new mongoose.Schema({
    trip_headsign: String,
    service_id: String,
    direction_id: Number,
    block_id: String,
    route_id: String, 
    shape_id: String,
    wheelchair_accessible: String,
    direction_name: String,
    trip_id: String,
},
    {
        collection:"trips"
    });
module.exports = mongoose.model('trips', tripModel);