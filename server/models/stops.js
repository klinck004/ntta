let mongoose = require('mongoose');

// create schema model for GTFS trip list
let stopModel = new mongoose.Schema({
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
},
    {
        collection:"stops"
    });
module.exports = mongoose.model('stops', stopModel);