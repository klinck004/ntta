let mongoose = require('mongoose');

// create schema model for GTFS trip list
let calendarModel = new mongoose.Schema({
    service_id: String,
    start_date: String,
    end_date: String,
    monday: Number, 
    tuesday: Number,
    wednesday: Number,
    thursday: Number,
    friday: Number,
    saturday: Number,
    sunday: Number
},
    {
        collection:"calendar"
    });
module.exports = mongoose.model('calendar', calendarModel);