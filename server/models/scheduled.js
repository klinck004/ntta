let mongoose = require('mongoose');

// create schema model for GTFS trip list
let scheduledModel = new mongoose.Schema({
    stop_id: String,
    zone_id: String,
    location_type: Number,
    stop_name: String,
    stop_desc: String,
    stop_lat: Number,
    stop_url: String,
    stop_timezone: String,
    wheelchair_boarding: Number,
    parent_station: String,
    preferred: Number,
    stop_lon: Number,
    stop_code: Number,
    trip_id: String,
    arrival_time: String,
    departure_time: String,
    stop_id: String,
    stop_sequence: Number,
    timepoint: Number,
    drop_off_type: Number,
    pickup_type: Number,
    stop_headsign: String,
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
        collection:"scheduled"
    });
module.exports = mongoose.model('scheduled', scheduledModel);