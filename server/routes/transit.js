const express = require('express');
const router = express.Router();
const moment = require('moment');

const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
const fetch = require('node-fetch');
const feedUrl = 'https://drtonline.durhamregiontransit.com/gtfsrealtime/VehiclePositions';
const tuURL = 'https://drtonline.durhamregiontransit.com/gtfsrealtime/TripUpdates';
const winston = require('winston');

// Create a logger instance
const logger = winston.createLogger({
  level: 'info', // Set the logging level
  format: winston.format.simple(), // Define the log format
  transports: [
    new winston.transports.Console() // Add a console transport
  ]
});

// Log some messages
logger.info('This is an informational message');
logger.warn('This is a warning message');
logger.error('This is an error message');


// Define getTrip to return static GTFS trip data
// Useful for full return and individual return


// Import models
let Trips = require('../models/trips');
let UniqueTrips = require('../models/unique_trips');
let Calendar = require('../models/calendar');
let CalendarDates = require('../models/calendar_dates');

// Master stop list
// Will be compiled with an external script and pushed to MongoDB database upon static GTFS feed change
// Gets unique trips, dropping duplicate "route_id", "direction_name", and "service_id"
// Gets stop order from stop_times.txt for each unique list and combines it with stop info in stops.txt
let StopList = require('../models/stop_list');
let Stops = require('../models/stops');
let StopTimes = require('../models/stop_times');
let Routes = require('../models/routes');
// Master static schedule
let Schedules = require('../models/scheduled');

// Find trip info from database by tripId
async function getTrip(tripId) {
    let value = await Trips.find({ trip_id: tripId });
    value = value[0]
    console.log(value)
    return value;
    
}

// Find stop info from database by stopId
async function getStop(stopId) {
    let value = await Stops.find({ stop_id: stopId });
    value = value[0]
    return value;
}

// Find static schedule / stop sequence info by tripId
async function getStopTime(tripId, stopId = undefined) {
    if (stopId === undefined) {
        let value = await StopTimes.find({ trip_id: tripId });
        return value
    } else {
        let value = await StopTimes.find({ trip_id: tripId, stop_id: stopId });
        return value
    }
}

// Get static route info by routeId
async function getRouteInfo(routeId) {
    let value = await Routes.find({ route_id: routeId });
    value = value[0]
    return value;
}

// getStopsOrder
// Concurrency limit for getStopsOrder
const pLimit = async () => {
    const module = await import('p-limit');
    return module.default;
};

// Initialize the limit once
let limit;
pLimit().then(lim => {
    limit = lim(5); // Concurrency limit
});

// Cache for getStopsOrder
const cache = new Map();
async function getStopCached(stopId) {
    if (cache.has(stopId)) {
        return cache.get(stopId);
    }
    const stopInfo = await getStop(stopId);
    cache.set(stopId, stopInfo);
    return stopInfo;
}

async function getStopsOrder(tripId) {
    while (!limit) {
        // Wait for limit to be initialized
        await new Promise(resolve => setTimeout(resolve, 50));
    }

    try {
        console.log("\ngetStopsOrder called");
        console.log("Recd tripId: " + tripId);
        let scheduleInfo = await getStopTime(tripId); // Get stop sequence and schedule information 

        // Iterate through scheduleInfo with concurrency control
        let stopPromises = scheduleInfo.map(stop =>
            limit(async () => {
                var stopInfo = await getStopCached(stop.stop_id); // Use cached version
                return { stop_id: stop.stop_id, stopInfo: stopInfo, stopSched: stop }; // Add each stop to stopList: stopId, stop INFORMATION, and stop sequence/timing
            })
        );

        const stopList = await Promise.all(stopPromises);
        stopList.sort((a, b) => a.stopSched.stop_sequence - b.stopSched.stop_sequence); // Sort list by sequence order -- first stop to last stop
        return stopList;
    } catch (error) {
        const errorOut = { tripError: 'Error occurred in getStopsOrder', err: error };
        console.error(error);
        return errorOut;
    }
}


// Get realtime vehicle information with static trip and static current stop info
async function getVehicleInfo(entityId) {
    try {
        // Init
        console.log("\ngetVehicleInfo called")
        console.log("Recd entityId: " + entityId)
        let feed = await gtfsRT(); // Refresh feed
        let returnVehicle = {}
        for (entity of feed.entity) { // Iterate through feed
            if (entity.id === entityId) { // If the entityId matches an entity's id
                returnVehicle = entity
                //console.log(holdVehicle) 
                let tripInfo = await getTrip(entity.vehicle.trip.tripId) // Get trip info
                let stopInfo = await getStop(entity.vehicle.stopId) // Get stop info
                returnVehicle.vehicle.trip.tripInfo = tripInfo
                returnVehicle.vehicle.trip.stopInfo = stopInfo
            }
        }
        if (Object.keys(returnVehicle).length === 0) {
            return ({ vehicleError: ('No vehicles of id: ' + entityId) });
        } else {
            return returnVehicle
        }

    } catch (error) {
        errorOut = ({ vehicleError: 'Error occurred in getVehicleInfo', err: error });
        console.error(error)
        return errorOut
    }

}

// Get full realtime route info
// Vehicle info, specific trip info, stop info
// for ALL VEHICLES on route -- individual vehicle call will be implemented later
async function fullRoute(routeName) {
    console.log("Full route request called")
    let feed = await gtfsRT();
    console.log("Rec'd route: " + routeName)
    if (routeName === undefined) {
        return ({ error: 'A route ID is required' });
    } else {
        // Add static trip data to result
        let data = JSON.parse(JSON.stringify(feed)); // Copy feed to data  
        var entityList = [];
        var finalData = { entity: entityList }
        await Promise.all(data.entity.map(async (entity) => { // This should probably also be moved into a function
            if (entity.vehicle.trip.routeId == routeName) {
                const [value, stops] = await Promise.all([
                    getTrip(entity.vehicle.trip.tripId),
                    getStop(entity.vehicle.stopId)
                ]);

                entity.vehicle.timestamp = new Date(entity.vehicle.timestamp * 1000) // Convert timestamp to datetime obj
                entity.vehicle.trip.tripInfo = value
                entity.vehicle.stops = stops;
                entityList.push(entity)
            }
        }));

        // Send JSON data
        if (entityList.length === 0) {
            console.log("No trips available")
            return ({ tripError: 'No trips available' });
        } else {
            return finalData;
        }
    }
}

// Get serviceId for current date
async function newGetServiceId() {
    // Get current date
    const d = new Date();
    let day = d.getDay();
    let date = (d.getDate() < 10 ? '0' : '') + d.getDate()
    let month = d.getMonth() + 1;
    month = (month < 10 ? '0' : '') + month
    let year = d.getFullYear();
    let fullDate = year + month + date

     
    let exceptionDate = await CalendarDates.find({date: fullDate})
    
    let daysInWeek= ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",]
    let dayOfWeek = (daysInWeek[day])
    logger.verbose('test')
    logger.verbose(`Date: ${fullDate}`)
    logger.verbose(`Day of week: ${day} ${dayOfWeek}`) 
    let result = await Calendar.find({[[dayOfWeek]]: 1, start_date: {$lte: fullDate}, end_date: {$gte: fullDate}})
    return result
}

// GTFS realtime data 
// *** When making changes for other agencies later consider that some agencies split realtime, trip updates, and alerts into separate feeds
// cough cough DRT
// See: https://gtfs.org/realtime/feed-entities/trip-updates/
// *** Potentially combine into one function with arguments that call/return the different types of data

// Master realtime only call
async function gtfsRT() {
    try {
        console.log("gtfsRT called -- Feed update")
        // Fetch realtime GTFS data
        const response = await fetch(feedUrl);
        if (!response.ok) {
            const error = new Error(`${response.url}: ${response.status} ${response.statusText}`);
            error.response = response;
            throw error;
        }
        const buffer = await response.arrayBuffer();
        let feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
        feed = JSON.parse(JSON.stringify(feed)); // Copy feed to data
        return feed
    } catch (error) {
        console.error(error)
    }
}

// Master tripupdate only call
async function gtfsTU() {
    try {
        console.log("gtfsTU called -- Feed trip update")
        // Fetch realtime GTFS data
        const response = await fetch(tuURL);
        if (!response.ok) {
            const error = new Error(`${response.url}: ${response.status} ${response.statusText}`);
            error.response = response;
            throw error;
        }
        const buffer = await response.arrayBuffer();
        let feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
        feed = JSON.parse(JSON.stringify(feed)); // Copy feed to data
        return feed
    } catch (error) {
        console.error(error)
    }
}

// API ROUTES

// Show scheduled routes
const routeCache = new Map();
async function getRouteCached(routeId) {
    if (routeCache.has(routeId)) {
        return routeCache.get(routeId);
    }
    const routeInfo = await getRouteInfo(routeId);
    routeCache.set(routeId, routeInfo);
    return routeInfo;
}

router.get('/routeList', async (req, res) => {
    try {

        const start = Date.now(); // Runtime testing
        const serviceId = await newGetServiceId();
        const serviceList = serviceId.map(doc => doc.service_id);
        //const serviceList = ['SatSun', 'SatSunReg', 'All Days_merged_999964'];

        const now = moment();
        const minus2 = now.clone().subtract(2, 'hours').format("HH:mm:ss");
        const plus2 = now.clone().add(2, 'hours').format("HH:mm:ss");
        let filtered = await Schedules.aggregate([
            {
              $match: {
                service_id: { $in: serviceList },
                arrival_time: { $gte: minus2, $lte: plus2 }
              }
            },
            {
              $group: {
                _id: { route_id: "$route_id"},
                // Optionally include other fields you want to retain
                arrival_time: { $first: "$arrival_time" }
              }
            },
            {
              $project: {
                _id: 0,
                route_id: "$_id.route_id",
              }
            },
            {
                $sort: { route_id: 1 } // Sort by route_id in ascending order
            }
          ]);
        
        const newFilter = await Promise.all(filtered.map(async (route) => {
            let routeInfo = await getRouteCached(route.route_id);
            return routeInfo;
        }));
        res.json(newFilter);
        const end = Date.now();
        console.log(`Execution time: ${end - start} ms`) // Return runtime
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching route info' });
    }
})

// Show stop list for route
router.get('/routeInfo', async (req, res) => {
    try {
        console.log('\nShow route called')
        let routeId = req.query.route
        console.log('Route:', req.query.route)
        const start = Date.now(); // Runtime testing
        const serviceId = await newGetServiceId();
        const serviceList = serviceId.map(doc => doc.service_id);
        console.log(serviceList)
        // const serviceList = ['SatSun', 'SatSunReg', 'All Days_merged_999964'];
        const now = moment();
        const minus2 = now.clone().subtract(2, 'hours').format("HH:mm:ss");
        const plus2 = now.clone().add(2, 'hours').format("HH:mm:ss");
        console.log('Minus 2 hrs:', minus2)
        console.log('Plus 2 hrs:', plus2)
        let filtered = await Schedules.aggregate([
            {
              $match: {
                service_id: { $in: serviceList },
                arrival_time: { $gte: minus2, $lte: plus2 }, 
                route_id: routeId
              }
            },
            {
              $group: {
                _id: "$trip_headsign",
                trip_id: { $first: "$trip_id" }
              }
            },
            {
                $sort: { _id: -1 } // Sort by trip_headsign in ascending order
            },
            {
                $project: {
                    _id: 0,
                    trip_headsign: "$_id",
                    trip_id: 1
                }
            }
          ]);
        if (filtered.length === 0) {
            
            console.log("Not yet scheduled")
            console.log(filtered)   
            res.json({ error: 'Not yet scheduled' });
        } else {
            let routeInfo = await getRouteCached(routeId);
            console.log(filtered)
            const routeBranches = await Promise.all(filtered.map(async (unique) => {
                console.log(unique.trip_headsign)
                
                let stopList = await getStopsOrder(unique.trip_id);
                return {trip_headsign: unique.trip_headsign, stopList};
            }));
            
            res.json({routeInfo, routeBranches}); 
        }
       
        const end = Date.now();
        console.log(`Execution time: ${end - start} ms`) // Return runtime
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching route info' });
    }
})

router.get('/test/gtfs', async (req, res) => {
    try {
        console.log("Full GTFS request called")
        let feed = await gtfsRT();

        // Add static trip data to result
        let data = JSON.parse(JSON.stringify(feed)); // Copy feed to data

        // Extract tripId from entity
        // Get static trip information using getTrip
        // Add static trip info to entity.vehicle.staticTrip
        // Promise.all makes sure that all async functions are complete before continuing
        await Promise.all(data.entity.map(async (entity) => {
            try {
                const tripId = entity.vehicle.trip.tripId;
                const value = await getTrip(tripId);
                entity.vehicle.timestamp = new Date(entity.vehicle.timestamp * 1000) // Convert timestamp to datetime obj
                entity.vehicle.staticTrip = value[0];
                const stopId = (entity.vehicle.stopId);
                var stops = await getStop(stopId);
                stops = stops[0];
                entity.vehicle.staticStop = stops;
            } catch (error) {
                console.error(error);
            }
        }));

        // Send JSON data
        res.json(data);

    } catch (error) {
        console.error('Error fetching GTFS-realtime data:', error);
        res.status(500).json({ error: 'Error fetching GTFS-realtime data' });
    }
});

// Get next vehicles at stop based on routeId
router.get('/nextStop', async (req, res) => {
    try {
        const start = Date.now(); // Runtime testing
        const routeName = req.query.route
        const stopId = req.query.stop
        console.log("Recd route: " + routeName)
        console.log("Recd stop: " + stopId)


        // GTFS RT CALL
        let realtimeFeed = await gtfsRT();
        realtimeFeed = realtimeFeed.entity.filter(entity => entity.vehicle.trip.routeId === routeName) // Return entities matching routeId
        // res.json(realtimeFeed); 

        let tripUpdateFeed = await gtfsTU();
        tripUpdateFeed = tripUpdateFeed.entity.filter(entity => entity.tripUpdate.trip.routeId === routeName) // Return entities matching routeId
        //tripUpdateFeed = tripUpdateFeed.tripUpdate.stopTimeUpdate.filter(stop => stop.stopId === stopId) // Return entities matching stopId
        //tripUpdateFeed = tripUpdateFeed.map(entity => entity.tripUpdate.stopTimeUpdate.filter(stop => stop.stopId === stopId)) // Return entities matching stopId

       
        res.json(tripUpdateFeed)

        // Runtime tracking
        const end = Date.now();
        console.log(`Execution time: ${end - start} ms`) // Return runtime
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching route info' });
    }
})

// Get next vehicles at stop based on routeId
router.get('/tripUpdate', async (req, res) => {
    try {
        const start = Date.now(); // Runtime testing; 
        let tripUpdateFeed = await gtfsTU();
        res.json(tripUpdateFeed)

        // Runtime tracking
        const end = Date.now();
        console.log(`Execution time: ${end - start} ms`) // Return runtime
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching route info' });
    }
})


module.exports = router;

