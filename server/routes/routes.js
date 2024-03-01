const express = require('express');
const router = express.Router();


const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
const fetch = require('node-fetch');
const feedUrl = 'https://drtonline.durhamregiontransit.com/gtfsrealtime/VehiclePositions';

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
        let value = await StopTimes.find({ trip_id: tripId});  
        return value
    } else {
        let value = await StopTimes.find({ trip_id: tripId, stop_id: stopId}); 
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
        var stopList = [];
        let scheduleInfo = await getStopTime(tripId) // Get stop sequence and schedule information 
    
        // Iterate through scheduleInfo
    
        await Promise.all(scheduleInfo.map(async (stop) => {
            let stopId = stop.stop_id; // Get stop id from stop_times.txt
            var stopInfo = await (getStop(stopId)); // Get stop INFORMATION from stops.txt
            stopList.push({ stop_id: stopId, stopInfo: stopInfo, stopSched: stop}); // Add each stop to stopList: stopId, stop INFORMATION, and stop sequence/timing
        })
        ); 
        stopList.sort((a, b) => a.stopSched.stop_sequence - b.stopSched.stop_sequence); // Sort list by sequence order -- first stop to last stop
        stopList = {stops: stopList} // Array in final result is now within stops object
        return stopList
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
            return ({ vehicleError: ('No vehicles of id: ' + entityId)});
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
                const tripId = entity.vehicle.trip.tripId;
                const value = await getTrip(tripId);
                entity.vehicle.timestamp = new Date(entity.vehicle.timestamp * 1000) // Convert timestamp to datetime obj
                entity.vehicle.staticTrip = value[0];
                const stopId = (entity.vehicle.stopId);
                var stops = await getStop(stopId);
                entity.vehicle.staticStop = stops;
                let entityHold = (entity)
                entityList.push(entityHold)
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

// API ROUTES
router.get('/beta/list', async (req, res) => {
    try {
        console.log("\nTest - Show routes ");    
        // Fetch GTFS data
        const feed = await gtfsRT();

        // Push active routes to list
        let routeList = [];
        for (const entity of feed.entity) {
            try {
                routeList.push(entity.vehicle.trip.routeId)
            } catch (error) {
                console.error(error);
            }
        }     
        // Drop duplicates
        routeList = routeList.filter((value, index, self) => {
            return self.indexOf(value) === index;
        });
        // Log info
        console.log(routeList)   
        
        // Get route info from routes.txt
        let routeInfo = await Routes.find({ route_id: routeList });
        console.log("***** Routing complete")
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
        finalData = {tripInfo: tripInfo, stops: stops}
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
    
        // Filter entities based on routeName
        let entityList = [];
        for (const entity of feed.entity) {
            try {
                if (entity.vehicle.trip.routeId === routeName) {
                    tripId = entity.vehicle.trip.tripId
                    trip = await getTrip(tripId)
                    entityList.push({trip: trip, entity_id: entity.id});
                }
            } catch (error) {
                console.error(error);
            }
        }

        // Get each unique direction/branch on a route
        const tripArray = entityList.map((entity) => {
            return {
                routeName: entity.trip.route_id,
                headsign: entity.trip.trip_headsign,
                trip: entity.trip.trip_id,
                entityId: entity.entity_id
            };
        });

        // Drop duplicate headsigns/branches
        const tripInfo = tripArray.filter((obj, index, self) =>
            index === self.findIndex((t) => t.headsign === obj.headsign)
        );

        let final = []

        for (branch of tripInfo) {
            tripId = branch.trip
            entityId = branch.entityId
            let stops = await getStopsOrder(tripId)
            final.push({route: branch.routeName, headsign: branch.headsign, stops: stops})
        }
        // Send response
        console.log("***** Routing complete")
        res.json(final);
    
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching route info' });
    }
    
})

// Testing/indev routes

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
        console.log("\nReturned data")
        console.log(currentVehicles)
        // Get schedule from getStopTimes / get GTFSRT tripupdate info when implemented
        for (const x of currentVehicles.entity) {
            try {
                console.log(x.vehicle.trip.tripId)
                currentStop = await getStopTime(x.vehicle.trip.tripId, stopId)
                x.stopInfo = currentStop[0]
                console.log(x.stopInfo)
                if (x.stopInfo === undefined) {
                    console.log("Stop info blank")
                    let index = currentVehicles.entity.findIndex(item => item.id === x.id);
                    if (index !== -1) {
                        currentVehicles.entity.splice(index, 1);
                        console.log("Removed")
                    }


                }
            } catch (error) {
                console.error(error);
            }
        }    
        console.log(currentVehicles)
        res.json(currentVehicles)
        // getStopTimes
        //currentStops = await getStopTime()

        // res.json("Lorem ipsum " + routeName + stopId)

        // Steps
        // Take routeId and get full route vehicle return
        // Implement full route vehicle return: take from current /route and place into standalone function
        // Get schedule from getStopTimes / get GTFSRT tripupdate info when implemented
            // GTFSRT tripupdate example for this exact situation:
                // Take tripId, iterate through stop_time_update until requested stop is found, return tripupdate info for stop
        // Show next... whatever number of trips for the route
        // If realtime is not available from tripupdate, return scheduled time and relay info accordingly on client side

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching route info' });
    }
    
})

// Old
router.get('/call/routeVehicles', async (req, res) => {
    try {
        console.log("OLD Route request called")
        let feed = await gtfsRT();
        routeName = req.query.route;
        console.log(routeName)
        if (routeName === undefined) {
            res.status(500).json({ error: 'A route ID is required' });
        } else {
            // Add static trip data to result
            let data = JSON.parse(JSON.stringify(feed)); // Copy feed to data  
            var entityList = [];
            var finalData = { entity: entityList }
            await Promise.all(data.entity.map(async (entity) => { // This should probably also be moved into a function
                try {
                    if (entity.vehicle.trip.routeId == routeName) {
                        const tripId = entity.vehicle.trip.tripId;
                        const value = await getTrip(tripId);
                        entity.vehicle.timestamp = new Date(entity.vehicle.timestamp * 1000) // Convert timestamp to datetime obj
                        entity.vehicle.staticTrip = value[0];
                        const stopId = (entity.vehicle.stopId);
                        var stops = await getStop(stopId);
                        stops = stops[0];
                        entity.vehicle.staticStop = stops;
                        let entityHold = (entity)
                        entityList.push(entityHold)
                    }
                } catch (error) {
                    console.error(error);
                }
            }));
            // Send JSON data
            if (entityList.length === 0) {
                console.log("No trips available")
                res.json({ tripError: 'No trips available' });
            } else {
                res.json(finalData);
                console.log(finalData)
            }
            console.log("***** Routing complete")
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching route info' });
    }
});


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
        let input = req.query.input
        let testFunc = await getVehicleInfo(input);
        res.json(testFunc)
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching route info' });
    }
})
module.exports = router;