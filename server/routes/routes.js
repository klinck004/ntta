const express = require('express');
const router = express.Router();


const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
const fetch = require('node-fetch');
const feedUrl = 'https://drtonline.durhamregiontransit.com/gtfsrealtime/VehiclePositions';
const tuURL = 'https://drtonline.durhamregiontransit.com/gtfsrealtime/TripUpdates';
// Define getTrip to return static GTFS trip data
// Useful for full return and individual return

// Get static trip info by tripId
let Trips = require('../models/trips');
async function getTrip(tripId) {
    let value = await Trips.find({ trip_id: tripId });
    value = value[0]
    return value;
}

// Get stop info by stopId
let Stops = require('../models/stops');
async function getStop(stopId) {
    let value = await Stops.find({ stop_id: stopId });
    value = value[0]
    return value;
}

// Get static schedule / stop sequence info by tripId
let StopTimes = require('../models/stop_times');
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
let Routes = require('../models/routes');
async function getRouteInfo(routeId) {
    let value = await Routes.find({ route_id: routeId });
    value = value[0]
    return value;
}

// Get static trip info and stops/schedule info in one request for route page
// by tripId
async function getStopsOrder(tripId) {
    try {
        console.log("\ngetStopsOrder called")
        console.log("Recd tripId: " + tripId)
        let scheduleInfo = await getStopTime(tripId) // Get stop sequence and schedule information 

        // Iterate through scheduleInfo

        let stopPromises = scheduleInfo.map(async (stop) => {
            var stopInfo = await (getStop(stop.stop_id)); // Get stop INFORMATION from stops.txt
            return ({ stop_id: stop.stop_id, stopInfo: stopInfo, stopSched: stop }); // Add each stop to stopList: stopId, stop INFORMATION, and stop sequence/timing
        });

        const stopList = await Promise.all(stopPromises);
        stopList.sort((a, b) => a.stopSched.stop_sequence - b.stopSched.stop_sequence); // Sort list by sequence order -- first stop to last stop
        return { stops: stopList }
    } catch (error) {
        errorOut = ({ tripError: 'Error occurred in getStopsOrder', err: error });
        console.error(error)
        return errorOut
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
router.get('/beta/list', async (req, res) => {
    try {
        console.log("\nTest - Show routes ");
        let feed = await gtfsRT();
        let tripIds = feed.entity.map(entity => entity.vehicle.trip.tripId);
        let tripInfo = await Trips.find({ trip_id: { $in: tripIds } });

        function filterDuplicates(array) {
            const seen = new Set();
            return array.filter(obj => {
                const key = `${obj.route_id}_${obj.trip_headsign}`; // Use template literals for key generation
                if (!seen.has(key)) {
                    seen.add(key);
                    return true;
                }
                return false;
            });
        }

        const currentRoutes = filterDuplicates(tripInfo);
        let routeIds = currentRoutes.map(entity => entity.route_id);
        let routeInfo = await Routes.find({ route_id: { $in: routeIds } });
        console.log(routeInfo)
        res.json(routeInfo)
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching route info' });
    }
})

// Beta routes
router.get('/beta/trip', async (req, res) => {
    try {
        console.log("\nFull trip info called")
        tripId = req.query.trip;
        console.log("Recd tripId ", tripId)
        let finalData = {}
        let tripInfo = await getTrip(tripId)
        let stops = await getStopsOrder(tripId); // Get static trip information
        finalData = { tripInfo: tripInfo, stops: stops }
        console.log("***** Routing complete")
        res.json(finalData)
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching route info' });
    }
})

// Get route info
router.get('/beta/routeInfo', async (req, res) => {
    try {
        console.log("Info called")
        routeId = req.query.route;
        console.log("Recd routeId ", routeId)
        let routeInfo = await getRouteInfo(routeId)
        console.log("***** Routing complete")
        res.json(routeInfo)
        console.log(routeInfo)
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching route info' });
    }
})

router.get('/beta/showRoute', async (req, res) => {
    try {
        console.log("\Test - Show route info called ");
        const routeName = req.query.route;

        // Fetch GTFS data
        const feed = await gtfsRT();
        const tripIds = feed.entity
            .filter(entity => entity.vehicle.trip.routeId === routeName)
            .map(entity => entity.vehicle.trip.tripId);

        console.log(tripIds)

        const tripDetails = await Promise.all(tripIds.map(tripId => getTrip(tripId)));
        console.log(tripDetails)
        const uniqueHeadsigns = [...new Set(tripDetails.map(trip => trip.trip_headsign))];
        console.log(uniqueHeadsigns)

        const final = await Promise.all(uniqueHeadsigns.map(async headsign => {
            const trip = tripDetails.find(trip => trip.trip_headsign === headsign);
            const stops = await getStopsOrder(trip.trip_id);
            return { route: trip.route_id, headsign, stops };
        }));

        // Send response
        console.log("***** Routing complete")
        res.json(final);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching route info' });
    }

})

// Next stop test
router.get('/test/next', async (req, res) => {
    try {
        console.log("\nStop test called");
        const routeName = req.query.route
        const stopId = req.query.stop
        console.log("Recd route: " + routeName)
        console.log("Recd stop: " + stopId)

        // Take routeId and get full route vehicle return
        currentVehicles = await fullRoute(routeName)
        console.log("\nCurrent vehicles on route")
        console.log(currentVehicles)
        stopInfo = await getStop(stopId)
        sendData = { stopInfo: stopInfo, currentVehicles }
        let tuFeed = await gtfsTU();

        // Get schedule from getStopTimes / get GTFSRT tripupdate info when implemented

        currentVehicles.entity = currentVehicles.entity.map(entity => {
            console.log(entity.vehicle.trip.tripId);
            const test = tuFeed.entity.find(obj => obj.tripUpdate.trip.tripId === entity.vehicle.trip.tripId);
            console.log(stopId);
            let stop = null;
            if (test) {
                stop = test.tripUpdate.stopTimeUpdate.find(obj => obj.stopId === stopId);
                console.log(stop);
            }
            entity.vehicle.trip.tripUpdate = stop
            return entity;
        });



        console.log(sendData)
        res.json(sendData)
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching route info' });
    }

})



router.get('/gtfs', async (req, res) => {
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

// Quick function test
router.get('/test/function', async (req, res) => {
    try {
        let feed = await gtfsRT();
        let tripHold = [];
        for (entity of feed.entity) {
            let tripId = entity.vehicle.trip.tripId
            tripHold.push(tripId);
        }
        let value = await Trips.find({ trip_id: tripHold });
        function filterDuplicates(array) {
            const seen = new Set();
            return array.filter(obj => {
                const key = obj.route_id + obj.trip_headsign;
                if (!seen.has(key)) {
                    seen.add(key);
                    return true;
                }
                return false;
            });
        }

        const currentRoutes = filterDuplicates(value);
        console.log(currentRoutes)
        res.json(currentRoutes)
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching route info' });
    }
})
module.exports = router;