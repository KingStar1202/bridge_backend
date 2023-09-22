const mongoose = require('mongoose');
const BlockSchema = new mongoose.Schema({
    chain: {
        type: String,
        required: true,
        unique: true
    },
    last: {
        type: String,
        required: true,
        
    },
   
    date: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('block', BlockSchema);