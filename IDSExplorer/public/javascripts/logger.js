var winston = require("winston");
var fs = require('fs');
var logger;
var config;
var options;

function loggerImpl(configObj){
    //var configJSON = fs.readFileSync("./config.json");
   // var configObj = JSON.parse(configJSON.toString());
    //var customlevels = {info:0,debug:1,warn:2,error:3};
    config = configObj.logger;
    options = fetchOptions();
    logger = new(winston.Logger)();
    if(options.transport == "File")
        logger.add(winston.transports.File,options);
    else
        logger.add(winston.transports.Console);
    return logger;
}

function fetchOptions(){
    options = new Object();
    options.level = config.LogLevel;
    /*
    if(config.LogLevel=="silly")
        options.level = 0;
    else if(config.LogLevel=="verbose")
        options.level = 1;
    else if(config.LogLevel=="info")
        options.level = 2;
    else if(config.LogLevel=="warn")
        options.level = 3;
    else if(config.LogLevel=="debug")
        options.level = 4;
    else if(config.LogLevel=="error")
        options.level = 5; */

    options.transport = config.OutPutMethod;
    options.filename = config.FileName;
    options.json = config.JsonFormat;
    return options;
}
exports.logger = loggerImpl;