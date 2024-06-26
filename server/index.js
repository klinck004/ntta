require('dotenv').config();
const cors = require('cors');
const express = require('express');
const mongoose = require('mongoose');
mongoose.set("strictQuery", false);
console.log('process.env.NODE_ENV = ' + process.env.NODE_ENV);

let mongoURL = process.env.MONGO_URL

// MongoDB init and connection
let mongoDB = mongoose.connection;
mongoose.connect(mongoURL).catch(error => console.log("MongoDB connection error: " + error));
mongoDB.once('open',()=>{console.log("MongoDB is connected")});

const app = express();
app.use(cors())
app.use(express.json());

const routes = require('./routes/routes');
const transit = require('./routes/transit');

app.use('/api', routes)
app.use('/new', transit)
app.listen(3000, () => {
    console.log(`Server Started at ${3000}`)
})