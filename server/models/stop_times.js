let mongoose = require('mongoose');

// create schema model for GTFS trip list
let stopTimeModel = new mongoose.Schema({
    trip_id: String,
    arrival_time: String,
    departure_time: String,
    stop_id: String,
    stop_sequence: Number,
    timepoint: Number,
    drop_off_type: Number,
    pickup_type: Number,
    stop_headsign: String,
},
    {
        collection:"stop_times"
    });
module.exports = mongoose.model('stop_times', stopTimeModel);