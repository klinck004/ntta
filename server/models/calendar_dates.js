let mongoose = require('mongoose');

// create schema model for GTFS trip list
let calendarDatesModel = new mongoose.Schema({
    service_id: String,
    date: String,
    exception_type: Number,
},
    {
        collection:"calendardates"
    });
module.exports = mongoose.model('calendardates', calendarDatesModel);