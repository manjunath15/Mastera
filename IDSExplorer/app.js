//
// Copyright (c) 2011 Mashery, Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining
// a copy of this software and associated documentation files (the
// 'Software'), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to
// the following conditions:
//
// The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
// IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
// CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
// TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
// SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
//

//
// Module dependencies
//
var express     = require('express'),
    util        = require('util'),
    fs          = require('fs'),
    OAuth       = require('oauth').OAuth,
    query       = require('querystring'),
    url         = require('url'),
    http        = require('http'),
    https       = require('https'),
    crypto      = require('crypto'),
    redis       = require('redis'),
    RedisStore  = require('connect-redis')(express),
    passport    = require('passport'),
    exec        = require('child_process').execFile,
    logger      = require('./public/javascripts/logger');
    IntuitStrategy = require('passport-intuit').Strategy;
    cmdObj      = require('child_process'),
    xml2js      = require('xml2js');
    SAML        = require('./saml');

// Configuration
var Log;

//Reading Configuration file as Sync so that application starts running only when configuration is read completely.
try {
    var configJSON = fs.readFileSync(__dirname + "/config.json");
    var config = JSON.parse(configJSON.toString());
    Log = logger.logger(config);
    Log.info("Logger Initialized");
} catch(e) {
    Log.error("File config.json not found or is invalid.  Try: `cp config.json.sample config.json`");
    //cannot run application if config file is not proper or not present.
    process.exit(1);
}

/*var proxy={
    host:'127.0.0.1',
    port:8888,
    localAddress: '127.0.0.1'
};*/
var proxy = null;
//
// Redis connection
//
var defaultDB = '0';
var db;

//If REDISTOGO_URL is configured in system environment then application uses it to connect to redis
Log.debug("Application Initialization: Connecting to Redis");
if (process.env.REDISTOGO_URL) {
    var rtg = require("url").parse(process.env.REDISTOGO_URL);
    db = require("redis").createClient(rtg.port, rtg.hostname);
    db.auth(rtg.auth.split(":")[1]);
} else {
    try{
        db = redis.createClient(config.redis.port, config.redis.host);
        db.auth(config.redis.password);
    }
    catch(e){
        Log.error("Redis configuration failed, Please check if redis server is running or it is properly configured")
        process.exit(1);
    }
}

if (process.env.REDISTOGO_URL) {
    var rtg   = require("url").parse(process.env.REDISTOGO_URL);
    config.redis.host = rtg.hostname;
    config.redis.port = rtg.port;
    config.redis.password = rtg.auth.split(":")[1];
    Log.debug(" Redis host" +rtg.hostname +" Redis Port " + rtg.port  );
}

// For catching error thrown by redis
db.on("error", function(err) {
        Log.error("Error " + err);
        process.exit(1);
});

//
// Load API Configs
//
Log.debug("Application Initialization: Reading servicesConfig file");
var apisConfig;
fs.readFile(__dirname +'/public/data/servicesConfig.json', 'utf-8', function(err, data) {
    if (err) throw err;
    apisConfig = JSON.parse(data);
    //Log.debug("Read Apis Config: " + util.inspect(apisConfig));
});

var app = module.exports = express.createServer();

Log.debug("Application Initialization: Configuring express framework");
app.configure(function() {
    app.set('views', __dirname + '/views');
    app.set('view engine', 'jade');
    app.use(express.logger());
    app.use(express.bodyParser());
    app.use(express.methodOverride());
    app.use(express.cookieParser());
    app.use(express.session({
        secret: config.sessionSecret,
        cookie: { maxAge: 30*24*60*60*1000},//One month validity
        store:  new RedisStore({
            'host':   config.redis.host,
            'port':   config.redis.port,
            'pass':   config.redis.password,
            'maxAge': 1209600000
        })
    }));

    app.use(passport.initialize());
    app.use(app.router);
    app.use(express.static(__dirname + '/public'));
    Log.debug("Initilization complete");
});

Log.debug("Application Initialization: configuring development environment of express");
app.configure('development', function() {
    app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
});

Log.debug("Application Initialization: configuring production environment of express");
app.configure('production', function() {
    app.use(express.errorHandler());
});

//passport
passport.serializeUser(function(user, done) {
    // db.set(user.emails[0].value, JSON.stringify(user), redis.print);
    done(null, user);
});

passport.deserializeUser(function(obj, done) {
    done(null, obj);
});


//
// Javascript Methods
//

function getSessionInfo(req, res){
    if(req.session){
        return req.session.id;
    } else {
        return "session expired";
    }
}
// Method to generate the xml for request body
function generateXML(api, bodyTemplate, entity, exclude){
    Log.debug('Inside generateXML, api ='+api + 'bodyTemplate=' + bodyTemplate + 'entity='+entity + 'exclude=' + exclude);
    var metaData = fs.readFileSync(__dirname + '/public/data/metadata/' + api + '.json');
    var metaData = JSON.parse(metaData);
    var str = '';
    var parentCache={};
    var xmlns_count = 1;
    Log.debug('The metadata is '+ metaData);
    function xmlnode(elementName, xmlns_id){
        for(var i in metaData[elementName]['attributes']){
            var node = metaData[elementName]['attributes'][i];
            if(!isObjectEmpty(node)) {
                if (!isExcludeElement(exclude, node.name)) {
                    var attrName = splitName(node.type);
                    if(metaData[attrName] && metaData[attrName].attributes.length > 0){
                        var nodeName =  xmlns_id != '' ? xmlns_id + ":" + node.name : node.name;
                        str = str + '<' + nodeName;
                        var xmlns_id_temp = xmlns_id;
                        if(metaData[splitName(node.type)].namespace){
                            xmlns_id_temp = 'ns' + xmlns_count++;
                            str = str + ' xmlns:' + xmlns_id_temp + '=\'' + metaData[splitName(node.type)].namespace + '\'>';
                        } else {
                            str = str + '>';
                        }

                        if(!parentCache[attrName]){
                            parentCache[attrName]=true;
                            xmlnode(attrName, xmlns_id_temp);
                        }
                        else {
                            str = str + ' ';
                        }
                    } else {
                        var nodeName =  xmlns_id != '' ? xmlns_id + ":" + node.name : node.name;
                        str = str + '<' + nodeName + '> ';
                    }
                    var nodeName =  xmlns_id != '' ? xmlns_id + ":" + node.name : node.name;
                    str = str + '</' + nodeName + '>';
                }
            }
        }
        var attrToDelete;
        var attrCounter = 0;
        for(var attrItem in parentCache){
            attrCounter = attrCounter+1;
            if(attrCounter>1)
                attrToDelete = attrItem;
        }
        delete parentCache[attrToDelete];
    }
    if(bodyTemplate && bodyTemplate.length > 0) {
        xmlnode(entity, '');
        Log.debug("before : " + str);
        str = bodyTemplate.replace('~ATTRIBUTES~', str);
        str = str.replace('~NAMESPACE~', ' xmlns=\"'+metaData[entity].namespace + '\"');
        Log.debug("after : " + str);
    } else {
        str = str + '<' + entity + ' xmlns=\''+metaData[entity].namespace+'\'>';
        xmlnode(entity, '');
        str = str + '</' + entity + '>';
    }
    Log.debug("Final xml is " + str);
    return str;
}
// Method to split the name and namespace identifiers
function splitName(name){
    var sp = name.split(':');
    if(sp.length > 1)
        return sp[1];
    else
        return name;
}

// Method to check whether the given element to be excluded or not
function isExcludeElement(exclude, elementName) {
    Log.debug('Inside isExcludeElement,exclude=' + exclude + 'ElementName=' + elementName);
    if(exclude) {
        for(var x in exclude) {
            if (elementName == exclude[x]) {
                return true;
                Log.debug('isExcludeElement exiting with true');
            }
        }
    }
    Log.debug('isExcludeElement exiting with false');
    return false;
}

// Method to check whether the given JSON object is empty
function isObjectEmpty(object) {
    for(keys in object) {
        return false;
    }
    return true;
}

// Method to check whether the browser is IE
function isIE(req) {
    var userAgent = req.headers['user-agent'];
    Log.debug('userAgent:' + userAgent);
    var result = userAgent.match(/MSIE/);
    if(result) {
        Log.debug('this is IE');
        return true;
    }
    return false;
}

// Method to check whether the request is from credentials popup
function isCredential(req) {
    var original_url = req.originalUrl;
    Log.debug('originalUrl:' + original_url);
    var result = original_url.match(/credential/);
    if(result) {
        Log.debug('This is credential Popup');
        return true;
    }
    return false;
}

//
// Middleware
//

// Method for making SAML call which fetches AggCat Oauth tokens.
function executeSamlAuth(req,res,next){
    try{
        var apiName = req.body.apiName;

        var subject = null;
        if(apiName == 'AggCat')
            subject=req.body.userId;
        else
            subject = req.body.batchId;

        if(!req.body.key ||
            !req.body.secret ||
            !req.body.spId ||
            !subject ||
            !req.files.certFile){
                if(isCredential(req) && isIE(req)) {
                    res.header('Content-Type', 'text/plain');
                }
                res.send({ 'err': 'Unable to process the SAML request. Please check the input parameters.' });
                return;
        }
        else {
            var saml = new SAML(
                {
                    signingKey: fs.readFileSync(req.files.certFile.path),
                    consumerKey: req.body.key,
                    issuer: req.body.spId,
                    subject: subject,
                    url: apisConfig[apiName].oauth.requestURL,
                    proxy: proxy}
            );
            saml.getResponse(function(err, resp){
                if(err){
                    if(isCredential(req) && isIE(req)) {
                        res.header('Content-Type', 'text/plain');
                    }
                    res.send({ 'err': err });
                }
                else{
                    var oauthTokens = saml.parseResponse(resp);
                    if(!oauthTokens.oauth_token || !oauthTokens.oauth_token_secret){
                        if(isCredential(req) && isIE(req)) {
                            res.header('Content-Type', 'text/plain');
                        }
                        res.send({ 'err': 'Unable to process the SAML request. Please check the input parameters. Error : ' + resp});
                        return;
                    }
                    Log.debug(getSessionInfo(req, res)+":"+"AccessToken " + oauthTokens.oauth_token);
                    Log.debug(getSessionInfo(req, res)+":"+"AccessSecret " + oauthTokens.oauth_token_secret);

                    var key = null;
                    if(req.session.loggedin)
                        key = req.session.passport.user.emails[0].value + ":" + apiName;
                    else
                        key = req.sessionID + ':' + apiName;

                    db.set(key + ':apiKey', req.body.key, redis.print);
                    db.set(key + ':apiSecret', req.body.secret, redis.print);
                    db.set(key + ':accessToken', oauthTokens.oauth_token, redis.print);
                    db.set(key + ':accessTokenSecret', oauthTokens.oauth_token_secret, redis.print);
                    db.set(key + ':spId', req.body.spId, redis.print);
                    db.set(key + ':subject', subject, redis.print);

                    if(!req.session[apiName])
                        req.session[apiName]={};
                    req.session[apiName].authed = true;

                    if(isCredential(req) && isIE(req)) {
                        res.header('Content-Type', 'text/plain');
                    }
                    res.send({ 'status': 'success' });
                }
            })
            return;
        }
    }
    catch(e){
        Log.error(getSessionInfo(req, res)+":"+"OAuth Token generation failed while calling saml module");
        if(isCredential(req) && isIE(req)) {
            res.header('Content-Type', 'text/plain');
        }
        res.send({ 'err': 'Unable to get the OAuth tokens while processing SAML request. Please check the input parameters.' });
    }
}

//Method to call dicsonnect api
function diconnectIDSapps(apiName, consumerKey, consumerSecret, accessKey, accessSecret, req, res, callback){
    Log.debug(getSessionInfo(req, res)+":"+'Inside disconnectIDSapps apiName=' + apiName + 'ConsumerKey=' + consumerKey + 'AccessKey=' + accessKey + 'AccesssSecret=' + accessSecret);
    var apiConfig = apisConfig[apiName],
        httpMethod = 'GET';
    var oa = new OAuth(apiConfig.oauth.requestURL || null,
        apiConfig.oauth.accessURL || null,
        consumerKey || null,
        consumerSecret || null,
        apiConfig.oauth.version || null,
        null,
        apiConfig.oauth.crypt);

    var privateReqURL = 'https://appcenter.intuit.com/api/v1/Connection/Disconnect';
    oa.getProtectedResource(privateReqURL, httpMethod, accessKey, accessSecret, null, null, proxy, function (error, data, response) {
        var parser = new xml2js.Parser();
        parser.parseString(data, function (err, result) {
            Log.debug(getSessionInfo(req, res)+":"+'Result is :' + util.inspect(result));
            if(result && result['PlatformResponse']){
                if(result['PlatformResponse']['ErrorCode'])
                {
                    if((result['PlatformResponse']['ErrorCode'][0]=="0") || (result['PlatformResponse']['ErrorCode'][0]=="270")){
                        callback(true);
                        return;
                    }
                }
            }
            callback(false);
            return;
        });
    })

}

// Method to fetch the base URL for V2QBO as it is not static
function getQBOBaseURL(apiName, consumerKey, consumerSecret, accessKey, accessSecret, req, res, next){
    Log.debug(getSessionInfo(req, res)+":"+'Inside getQBOBaseURL apiName=' + apiName + 'ConsumerKey=' + consumerKey + 'AccessKey=' + accessKey + 'AccesssSecret=' + accessSecret);
    var apiConfig = apisConfig[apiName],
        httpMethod = 'GET';
    var oa = new OAuth(apiConfig.oauth.requestURL || null,
        apiConfig.oauth.accessURL || null,
        consumerKey || null,
        consumerSecret || null,
        apiConfig.oauth.version || null,
        null,
        apiConfig.oauth.crypt);

    if(req.query.realmId){
        var privateReqURL = 'https://qbo.intuit.com/qbo1/rest/user/v2/'+req.query.realmId;
        oa.getProtectedResource(privateReqURL, httpMethod, accessKey, accessSecret, null,  null, proxy, function (error, data, response) {
            Log.debug(getSessionInfo(req, res)+":"+'This is the responsse' + response);
            var parser = new xml2js.Parser();
            parser.parseString(data, function (err, result) {
                Log.debug(getSessionInfo(req, res)+":"+'Result is :' + result);
                if(result['qbo:QboUser']){
                    if(result['qbo:QboUser']['qbo:CurrentCompany'])
                    {
                        for(var i in result['qbo:QboUser']['qbo:CurrentCompany']){
                            var company = result['qbo:QboUser']['qbo:CurrentCompany'][i];
                            if(company['qbo:CompanyId'][0]==req.query.realmId && company['qbo:BaseURI']){
                                req.session[apiName].baseURL = company['qbo:BaseURI'][0];
                            }
                        }
                    }
                }
                next();
            });
        })
    }
}

// Method to get the saved info from db
function getSavedInfo(req, res, next){
    Log.debug(getSessionInfo(req, res)+":"+'Inside getSavedInfo');
    var apiName = req.params.api;
    Log.debug(getSessionInfo(req, res)+":"+'The API Name is ' + apiName);
    if(req.session.loggedin)
        key = req.session.passport.user.emails[0].value + ":" + apiName;
    else
        key = req.sessionID + ':' + apiName;
    db.mget([
        key + ':accessToken',
        key + ':accessTokenSecret',
        key + ':apiKey',
        key + ':apiSecret',
        key + ':params',
        key + ':savedParams',
        key + ':savedRequestBody',
        key + ':savedHeaders',
        key + ':spId',
        key + ':subject'
    ], function(err, result) {
        if(!req.session[apiName]){
            req.session[apiName] = {};
        }
        if (err) {
            Log.error(getSessionInfo(req, res)+":"+util.inspect(err));
            next();
        }  else if(result[0] != null && result[1] != null && result[2] != null && result[3] != null){
            req.session[apiName].authed = true
            req.session[apiName].apiKey = result[2];
            req.session[apiName].apiSecret = result[3];
            req.session[apiName].accessToken = result[0];
            req.session[apiName].accessTokenSecret = result[1];
            if(apiName.indexOf('AggCat') != -1) {
                req.session[apiName].spId = result[8];
                req.session[apiName].subject = result[9];
            }
            if(!apisConfig[apiName])
                apisConfig[apiName]={};
        }
        else {
            req.session[apiName].authed = false;
            req.session[apiName].apiKey = '';
            req.session[apiName].apiSecret = '';
            req.session[apiName].accessToken = '';
            req.session[apiName].accessTokenSecret = '';
            if(apiName.indexOf('AggCat') != -1) {
                req.session[apiName].spId = '';
                req.session[apiName].subject = '';
            }
        }

        if(result[4] != null){
            req.session[apiName].params = JSON.parse(result[4]);
        } else {
            req.session[apiName].params = null;
        }

        if(result[5] != null){
            req.session[apiName].savedParams = JSON.parse(result[5]);
        } else {
            req.session[apiName].savedParams = null;
        }

        if(result[6] != null){
            req.session[apiName].savedRequestBody = JSON.parse(result[6]);
        } else {
            req.session[apiName].savedRequestBody = null;
        }

        if(result[7] != null){
            req.session[apiName].savedHeaders = JSON.parse(result[7]);
        } else {
            req.session[apiName].savedHeaders=null;
        }

        next();
    });
}

// Method to save the request to db.
// This will be called before the processRequest() method
function saveRequest(req, res, next) {
    Log.debug(getSessionInfo(req, res)+":"+"Inside Save request");
    var apiName = req.body.apiName;
    if(req.session.loggedin){
        Log.debug(getSessionInfo(req, res)+":"+'The user is loggedin');
        key = req.session.passport.user.emails[0].value + ':' + apiName;
    }
    // Unique key using the username and API name to store tokens and secrets
    else{
        Log.debug(getSessionInfo(req, res)+":"+'The user is not loggedin, so using the sessionid as base key');
        key = req.sessionID + ':' + apiName;
    }

    // Unique key using the sessionID and API name to store tokens and secrets
    if(req.session[req.body.apiName].savedParams == null)
        req.session[req.body.apiName].savedParams = {};
    req.session[req.body.apiName].savedParams[req.body.endpointName+':'+req.body.methodName]=req.body.params
    db.set(key + ':savedParams' , JSON.stringify(req.session[req.body.apiName].savedParams), redis.print);

    if(req.session[req.body.apiName].savedRequestBody == null)
        req.session[req.body.apiName].savedRequestBody = {};
    req.session[req.body.apiName].savedRequestBody[req.body.endpointName+':'+req.body.methodName]=req.body.requestBody;
    db.set(key + ':savedRequestBody' , JSON.stringify(req.session[req.body.apiName].savedRequestBody), redis.print);
    Log.debug(getSessionInfo(req, res)+":"+'Saved request body');
    if(req.session[req.body.apiName].savedHeaders == null)
        req.session[req.body.apiName].savedHeaders = {};
    req.session[req.body.apiName].savedHeaders[req.body.endpointName+':'+req.body.methodName]=req.body.headers;
    db.set(key + ':savedHeaders' , JSON.stringify(req.session[req.body.apiName].savedHeaders), redis.print);
    Log.debug(getSessionInfo(req, res)+":"+'Saved request headers');
    next();
}

// Method to handle the OAuth credentials for all services
function handleCredentials(req, res, next){
    Log.debug(getSessionInfo(req, res)+":"+"Inside handleCredentials");
    if(req.body.submit && req.body.submit == "Disconnect"){
        removeCredentials(req, res, next);
    } else if(!req.body.accessKey || !req.body.accessSecret){
        Log.debug(getSessionInfo(req, res)+":"+'Access key and Access secret not provided, so going through the oauth flow')
        oauth(req, res, next);
    } else {
        saveCredentials(req, res, next);
    }
}

// Method to remove credentials from db and session when user clicks on Invalidate
function removeCredentials(req, res, next) {
    Log.info(getSessionInfo(req, res)+":"+"Inside removeCredentials");
    var apiName = req.body.apiName;

    //By default status will be true. when disconnect is called for IDS status of status variable will change accordingly.
    var status = true;
    if(apiName.indexOf('AggCat') < 0)
    diconnectIDSapps(apiName, req.session[apiName].apiKey, req.session[apiName].apiSecret, req.session[apiName].accessToken, req.session[apiName].accessTokenSecret, req, res, function(status){
        if(status == true){
            if(req.session.loggedin)
                key = req.session.passport.user.emails[0].value + ':' + apiName;
            // Unique key using the username and API name to store tokens and secrets
            else
                key = req.sessionID + ':' + apiName;
            db.del(key + ':apiKey');
            db.del(key + ':apiSecret');
            db.del(key + ':requestToken');
            db.del(key + ':requestTokenSecret');
            db.del(key + ':accessToken');
            db.del(key + ':accessTokenSecret');
            db.del(key + ':params');
            if(apiName.indexOf('AggCat') != -1) {
                db.del(key + ':spId');
                db.del(key + ':subject');
            }
            Log.debug(getSessionInfo(req, res)+":"+'Removed all credentials');
            try {
                req.session[apiName].authed = false;
                req.session[apiName].default = false;
            } catch(e) {
                Log.error("Error while invalidate the tokens for expired session. " + e);
            }
            next();
            //req.session[apiName].params = {};
        } else{
            res.send({ err: "Error while calling disconnect api. Please try again after sometime."});
        }
    });
}

// Method to save credentials to db and session
function saveCredentials(req, res, next){
    Log.debug(getSessionInfo(req, res)+":"+"Inside saveCredentials");
    var apiName = req.body.apiName;
    if(req.session.loggedin)
        key = req.session.passport.user.emails[0].value + ':' + apiName;
    // Unique key using the username and API name to store tokens and secrets
    else
        key = req.sessionID + ':' + apiName;

    if(!req.body.key || !req.body.secret || !req.body.accessKey || !req.body.accessSecret || !req.body.realmId) {
        res.send({ err: "Unable to process your request. Please provide valid credentials."});
    } else if(req.body.key && req.body.secret && req.body.accessKey && req.body.accessSecret && req.body.realmId) {
        db.set(key + ':apiKey', req.body.key, redis.print);
        db.set(key + ':apiSecret', req.body.secret, redis.print);
        db.set(key + ':accessToken', req.body.accessKey, redis.print);
        db.set(key + ':accessTokenSecret', req.body.accessSecret, redis.print);

        var realmIdString = {
            'realmId' : req.body.realmId
        }
        var apiConfig = apisConfig[apiName];
        // Inserting linked params in returned params
        if(apiConfig.LinkParams){
            for(var i in apiConfig.LinkParams){
                if(req.body[i])
                    realmIdString[apiConfig.LinkParams[i]]=req.body.realmId;
            }
        }
        db.set(key + ':params', JSON.stringify(realmIdString), redis.print);
        //req.session[apiName].params = realmIdString;

        Log.debug(getSessionInfo(req, res)+":"+'Saved the credentials');
        if(!req.session[apiName])
            req.session[apiName]={};
        req.session[apiName].authed = true;
        if(isCredential(req) && isIE(req)) {
            res.header('Content-Type', 'text/plain');
        }
        res.send({ 'status': 'success' });
    } else
        next();
}

// Method to authorize for the given oauth credentials
function oauth(req, res, next){
    Log.debug(getSessionInfo(req, res)+":"+'Inside oauth');
    var apiName = req.body.apiName,
        apiConfig = apisConfig[apiName];

    if (apiConfig.oauth ) {
        if(apiConfig.oauth.type !='saml'){
            var apiKey = req.body.apiKey || req.body.key,
                apiSecret = req.body.apiSecret || req.body.secret,
                refererURL = url.parse(req.headers.referer),
                callbackURL = refererURL.protocol + '//' + refererURL.host + '/authSuccess/' + apiName,
                oa = new OAuth(apiConfig.oauth.requestURL,
                    apiConfig.oauth.accessURL,
                    apiKey,
                    apiSecret,
                    apiConfig.oauth.version,
                    callbackURL,
                    apiConfig.oauth.crypt);

            Log.debug(getSessionInfo(req, res)+":"+'OAuth type: ' + apiConfig.oauth.type);
            Log.debug(getSessionInfo(req, res)+":"+'Method security: ' + req.body.oauth);
            Log.debug(getSessionInfo(req, res)+":"+'Session authed: ' + req.session[apiName]);
            Log.debug(getSessionInfo(req, res)+":"+'apiKey: ' + apiKey);
            Log.debug(getSessionInfo(req, res)+":"+'apiSecret: ' + apiSecret);
        }
        // Check if the API even uses OAuth, then if the method requires oauth, then if the session is not authed
        if (apiConfig.oauth.type == 'three-legged' && req.body.oauth == 'authrequired' && (!req.session[apiName] || !req.session[apiName].authed)) {
                //Log.debug('req.session: ' + util.inspect(req.session));
                //Log.debug('headers: ' + util.inspect(req.headers));
                Log.debug(getSessionInfo(req, res)+":"+'sessionID: ' + util.inspect(req.sessionID));
            oa.getOAuthRequestToken(function(err, oauthToken, oauthTokenSecret, proxy, results, requestHeader) {
                if (err) {
                    Log.error(getSessionInfo(req, res)+":"+"Error getting OAuth request token : " + util.inspect(err));
                    if(isCredential(req) && isIE(req)) {
                        res.header('Content-Type', 'text/plain');
                    }
                    res.send({ err: "Unable to process your request. Please provide valid credentials.", code: err.statusCode, response: err.data });
                } else {
                    var key;
                    if(req.session.loggedin)
                        key = req.session.passport.user.emails[0].value + ':' + apiName;
                    // Unique key using the username and API name to store tokens and secrets
                    else
                        key = req.sessionID + ':' + apiName;
                    // Unique key using the sessionID and API name to store tokens and secrets

                    db.set(key + ':apiKey', apiKey, redis.print);
                    db.set(key + ':apiSecret', apiSecret, redis.print);

                    db.set(key + ':requestToken', oauthToken, redis.print);
                    db.set(key + ':requestTokenSecret', oauthTokenSecret, redis.print);
                    if(isCredential(req) && isIE(req)) {
                        res.header('Content-Type', 'text/plain');
                    }
                    res.send({ 'signin': apiConfig.oauth.signinURL + oauthToken });
                }
            });

        } else if (apiConfig.oauth.type == 'two-legged' && req.body.oauth == 'authrequired') {
            next();
        } else if(apiConfig.oauth.type=="saml" && req.body.oauth == 'authrequired' && req.body.generateTokens == 'saml') {
            //&& (!req.session[apiName] || !req.session[apiName].authed)){
           executeSamlAuth(req, res, next);
        } else {
            next();
        }
    } else {
        next();
    }
}

// Method to handle oauth callback if request tokens are returned
function oauthSuccess(req, res, next){
    Log.debug(getSessionInfo(req, res)+":"+"Inside oauthSuccess");
    var oauthRequestToken,
        oauthRequestTokenSecret,
        apiKey,
        apiSecret,
        apiName = req.params.api,
        apiConfig = apisConfig[apiName];

    var key;
    if(req.session.loggedin) {
        key = req.session.passport.user.emails[0].value  + ':' + apiName;
    } else {
        key = req.sessionID + ':' + apiName; // Unique key using the sessionID and API name to store tokens and secrets
    }
    Log.debug(getSessionInfo(req, res)+":"+'apiName: ' + apiName);
    Log.debug(getSessionInfo(req, res)+":"+'key: ' + key);
    Log.debug(getSessionInfo(req, res)+":"+util.inspect(req.params));

    db.mget([
        key + ':requestToken',
        key + ':requestTokenSecret',
        key + ':apiKey',
        key + ':apiSecret'
    ], function(err, result) {
        if (err) {
            Log.error(getSessionInfo(req, res)+":"+util.inspect(err));
        }
        oauthRequestToken = result[0],
            oauthRequestTokenSecret = result[1],
            apiKey = result[2],
            apiSecret = result[3];

            Log.debug(getSessionInfo(req, res)+":"+util.inspect(">>"+oauthRequestToken));
            Log.debug(getSessionInfo(req, res)+":"+util.inspect(">>"+oauthRequestTokenSecret));
            Log.debug(getSessionInfo(req, res)+":"+util.inspect(">>"+req.query.oauth_verifier));

        var oa = new OAuth(apiConfig.oauth.requestURL,
            apiConfig.oauth.accessURL,
            apiKey,
            apiSecret,
            apiConfig.oauth.version,
            null,
            apiConfig.oauth.crypt);

            Log.debug(getSessionInfo(req, res)+":"+util.inspect(oa));

        oa.getOAuthAccessToken(oauthRequestToken, oauthRequestTokenSecret, req.query.oauth_verifier, proxy, function(error, oauthAccessToken, oauthAccessTokenSecret, results) {
            if (error) {
                Log.error(getSessionInfo(req, res)+":"+"Error getting OAuth access token : " + util.inspect(error));
                if(isCredential(req) && isIE(req)) {
                    res.header('Content-Type', 'text/plain');
                }
                res.send("Error while getting OAuth access token : " + util.inspect(error) + "["+oauthAccessToken+"]"+ "["+oauthAccessTokenSecret+"]"+ "["+util.inspect(results)+"]", 500);
            } else {
                Log.debug(getSessionInfo(req, res)+":"+'results: ' + util.inspect(results));

                // Inserting linked params in returned params
                if(apiConfig.LinkParams){
                    for(var i in apiConfig.LinkParams){
                        if(req.query[i])
                            req.query[apiConfig.LinkParams[i]]=req.query[i];
                    }
                }

                db.mset([key + ':accessToken', oauthAccessToken,
                    key + ':accessTokenSecret', oauthAccessTokenSecret,
                    key + ':params', JSON.stringify(req.query)
                ], function(err, results2) {
                    req.session[apiName] = {};
                    req.session[apiName].authed = true;
                    req.session[apiName].params = req.query;
                    Log.debug(getSessionInfo(req, res)+":"+'session[apiName].authed: ' + util.inspect(req.session));
                    if(apiName=='V2QBO')
                        getQBOBaseURL(apiName, apiKey, apiSecret, oauthAccessToken, oauthAccessTokenSecret, req, res, next);
                    else
                        next();
                });
            }
        });
    });
}

//
// processRequest - handles API call
//
function processRequest(req, res, next) {
    Log.debug(getSessionInfo(req, res)+":"+"Inside processRequest");
    Log.debug(getSessionInfo(req, res)+":"+util.inspect(req.body, null, 3));
    var reqQuery = req.body,
        methodURL = reqQuery.methodUri,
        httpMethod = reqQuery.httpMethod,
        apiKey = reqQuery.apiKey,
        apiSecret = reqQuery.apiSecret,
        apiName = reqQuery.apiName,
        headers = reqQuery.headers
    apiConfig = apisConfig[apiName];

    var params = new Object();
    if(reqQuery.params){
        for (var item in reqQuery.params){
            params[item]=reqQuery.params[item];
        }
    }


    var key;
    if(req.session.loggedin)
        key = req.session.passport.user.emails[0].value + ':' + apiName;
    else
        key = req.sessionID + ':' + apiName;
    Log.debug(getSessionInfo(req, res)+":"+'Proceeding to replace placeholders in methodURL');
    // Replace placeholders in the methodURL with matching params
    for (var param in params) {
        if (params.hasOwnProperty(param)) {
            if (params[param] !== '') {
                // URL params are prepended with ":"
                var regx = new RegExp(':' + param);

                // If the param is actually a part of the URL, put it in the URL and remove the param
                if (!!regx.test(methodURL)) {
                    methodURL = methodURL.replace(regx, params[param]);
                    delete params[param];
                }
            } else {
                var regx = '/:' + param;
                methodURL = methodURL.replace(regx, "");
                delete params[param]; // Delete blank params
            }
        }
    }

    var baseHostInfo = apiConfig.baseURL.split(':');
    var baseHostUrl = baseHostInfo[0],
        baseHostPort = (baseHostInfo.length > 1) ? baseHostInfo[1] : "";

    var paramString = query.stringify(params),
        options = {
            headers: {},
            protocol: apiConfig.protocol + ':',
            host: baseHostUrl,
            port: baseHostPort,
            method: httpMethod,
            path: apiConfig.publicPath + methodURL// + ((paramString.length > 0) ? '?' + paramString : "")
        };
    Log.debug(getSessionInfo(req, res)+":"+'ParamString is ' +paramString);
    Log.debug(getSessionInfo(req, res)+":"+'BaseHost URL ' + baseHostUrl + 'BaseHost Port ' + baseHostPort);
    var privateReqURL;
    var paramStringTemp = "";
    if(paramString.length > 0) {
        paramStringTemp = (methodURL.indexOf("?") == -1) ? '?' + paramString : '&' + paramString;
    }
    if(req.session[apiName].baseURL){
        privateReqURL = req.session[apiName].baseURL + methodURL + paramStringTemp;
    } else {
        privateReqURL = apiConfig.protocol + '://' + apiConfig.baseURL + apiConfig.privatePath + methodURL + paramStringTemp;
    }
    var requestBody = "";
    Log.debug(getSessionInfo(req, res)+":"+'Private URL is ' + privateReqURL);
    if (['POST','DELETE','PUT'].indexOf(httpMethod) !== -1 && !req.body.requestBody) {
        requestBody = query.stringify(params);
    } else if(['POST','DELETE','PUT'].indexOf(httpMethod) !== -1 && req.body.requestBody) {
        requestBody = req.body.requestBody;
    }
    Log.debug(getSessionInfo(req, res)+":"+'Request body is ' + util.inspect(requestBody));
    if (apiConfig.oauth) {
        Log.debug(getSessionInfo(req, res)+":"+'Using OAuth');

        // Three legged OAuth
        if ((apiConfig.oauth.type == 'three-legged' || apiConfig.oauth.type == 'saml') && (reqQuery.oauth == 'authrequired' || (req.session[apiName] && req.session[apiName].authed))) {
              Log.debug(getSessionInfo(req, res)+":"+'Three Legged OAuth');

            db.mget([key + ':apiKey',
                key + ':apiSecret',
                key + ':accessToken',
                key + ':accessTokenSecret'
            ],
                function(err, results) {

                    var apiKey = results[0],
                        apiSecret = results[1],
                        accessToken = results[2],
                        accessTokenSecret = results[3];

                        Log.debug(getSessionInfo(req, res)+":"+"apiKey:"+ apiKey);
                        Log.debug(getSessionInfo(req, res)+":"+"apiSecret:" +apiSecret);
                        Log.debug(getSessionInfo(req, res)+":"+"accessToken:" +accessToken);
                        Log.debug(getSessionInfo(req, res)+":"+"accessTokenSecret:" +accessTokenSecret);

                    var oa = new OAuth(apiConfig.oauth.requestURL || null,
                        apiConfig.oauth.accessURL || null,
                        apiKey || null,
                        apiSecret || null,
                        apiConfig.oauth.version || null,
                        null,
                        apiConfig.oauth.crypt);

                    oa.getProtectedResource(privateReqURL, httpMethod, accessToken, accessTokenSecret, requestBody, headers, proxy, function (error, data, response, requestHeader) {
                        req.call = privateReqURL;

                        // console.log(util.inspect(response));
                        if (error) {
                            Log.error(getSessionInfo(req, res)+":"+'Got error: ' + util.inspect(error));

                            if(requestHeader)
                                req.requestHeaders = requestHeader;

                            if(response && response.headers){
                                req.resultHeaders = response.headers;
                            }

                            if (error.data == 'Server Error' || error.data == '') {
                                req.result = 'Server Error';
                            } else {
                                req.result = error.data;
                            }

                            res.statusCode = error.statusCode

                            next();
                        } else {
                            if(requestHeader)
                                req.requestHeaders = requestHeader;

                            req.resultHeaders = response.headers;
                            if(response.headers['content-type'].indexOf("json") >=0) {
                                req.result = JSON.parse(data);
                            }
                            else
                                req.result = data;
                            next();
                        }
                    });
                }
            );
        } else if (apiConfig.oauth.type == 'two-legged' && reqQuery.oauth == 'authrequired') { // Two-legged

            Log.debug(getSessionInfo(req, res)+":"+'Two Legged OAuth');

            var body,
                oa = new OAuth(null,
                    null,
                    apiKey || null,
                    apiSecret || null,
                    apiConfig.oauth.version || null,
                    null,
                    apiConfig.oauth.crypt);

            var resource = options.protocol + '://' + options.host + options.path,
                cb = function(error, data, response) {
                    if (error) {
                        Log.error(getSessionInfo(req, res)+":"+"Error occured " + error.data);
                        if (error.data == 'Server Error' || error.data == '') {
                            req.result = 'Server Error';
                        } else {
                            body = error.data;
                        }

                        res.statusCode = error.statusCode;

                    } else {
                        var responseContentType = response.headers['content-type'];

                        switch (true) {
                            case /application\/javascript/.test(responseContentType):
                            case /text\/javascript/.test(responseContentType):
                            case /application\/json/.test(responseContentType):
                                body = JSON.parse(data);
                                break;
                            case /application\/xml/.test(responseContentType):
                            case /text\/xml/.test(responseContentType):
                            default:
                        }
                    }

                    // Set Headers and Call
                    if (response) {
                        req.resultHeaders = response.headers || 'None';
                    } else {
                        req.resultHeaders = req.resultHeaders || 'None';
                    }

                    req.call = url.parse(options.host + options.path);
                    req.call = url.format(req.call);

                    // Response body
                    req.result = body;

                    next();
                };

            switch (httpMethod) {
                case 'GET':
                    Log.debug(getSessionInfo(req, res)+":"+"Inside GET,Resource :" + resource);
                    oa.get(resource, '', '',cb);
                    break;
                case 'PUT':
                case 'POST':
                    Log.debug(getSessionInfo(req, res)+":"+"Inside POST,Resource :" + resource);
                    oa.post(resource, '', '', JSON.stringify(obj), null, cb);
                    break;
                case 'DELETE':
                    Log.debug(getSessionInfo(req, res)+":"+"Inside DELETE,Resource :" + resource);
                    oa.delete(resource,'','',cb);
                    break;
            }

        } else {
            // API uses OAuth, but this call doesn't require auth and the user isn't already authed, so just call it.
            unsecuredCall();
        }
    } else {
        // API does not use authentication
        unsecuredCall();
    }

    // Unsecured API Call helper
    function unsecuredCall() {
        Log.debug(getSessionInfo(req, res)+":"+'Unsecured Call');

        if (['POST','PUT','DELETE'].indexOf(httpMethod) === -1) {
            options.path += ((paramString.length > 0) ? '?' + paramString : "");
        }

        // Add API Key to params, if any.
        if (apiKey != '' && apiKey != 'undefined' && apiKey != undefined) {
            if (options.path.indexOf('?') !== -1) {
                options.path += '&';
            }
            else {
                options.path += '?';
            }
            options.path += apiConfig.keyParam + '=' + apiKey;
        }
        Log.debug(getSessionInfo(req, res)+":"+'Going to perform signature routine');
        // Perform signature routine, if any.
        if (apiConfig.signature) {
            if (apiConfig.signature.type == 'signed_md5') {
                // Add signature parameter
                var timeStamp = Math.round(new Date().getTime()/1000);
                var sig = crypto.createHash('md5').update('' + apiKey + apiSecret + timeStamp + '').digest(apiConfig.signature.digest);
                options.path += '&' + apiConfig.signature.sigParam + '=' + sig;
            }
            else if (apiConfig.signature.type == 'signed_sha256') { // sha256(key+secret+epoch)
                // Add signature parameter
                var timeStamp = Math.round(new Date().getTime()/1000);
                var sig = crypto.createHash('sha256').update('' + apiKey + apiSecret + timeStamp + '').digest(apiConfig.signature.digest);
                options.path += '&' + apiConfig.signature.sigParam + '=' + sig;
            }
        }
        Log.debug(getSessionInfo(req, res)+":"+'Going to setup header info');
        // Setup headers, if any
        if (reqQuery.headerNames && reqQuery.headerNames.length > 0) {

            Log.debug(getSessionInfo(req, res)+":"+'Setting headers');

            var headers = {};

            for (var x = 0, len = reqQuery.headerNames.length; x < len; x++) {

                Log.debug(getSessionInfo(req, res)+":"+'Setting header: ' + reqQuery.headerNames[x] + ':' + reqQuery.headerValues[x]);
                if (reqQuery.headerNames[x] != '') {
                    headers[reqQuery.headerNames[x]] = reqQuery.headerValues[x];
                }
            }

            options.headers = headers;
        }

        //TODO: FIX headers for unsecured call
        if (!options.headers['Content-Length']) {
            if (requestBody) {
                options.headers['Content-Length'] = requestBody.length;
            }
            else {
                options.headers['Content-Length'] = 0;
            }
        }

        if (requestBody) {
            options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        }


        Log.debug(getSessionInfo(req, res)+":"+'Options are ' +util.inspect(options));

        var doRequest;
        if (options.protocol === 'https' || options.protocol === 'https:') {
            Log.debug(getSessionInfo(req, res)+":"+'Protocol: HTTPS');
            options.protocol = 'https:'
            doRequest = https.request;
        } else {
            Log.debug(getSessionInfo(req, res)+":"+'Protocol: HTTP');
            doRequest = http.request;
        }

        // API Call. response is the response from the API, res is the response we will send back to the user.
        var apiCall = doRequest(options, function(response) {
            response.setEncoding('utf-8');

            Log.debug(getSessionInfo(req, res)+":"+'HEADERS: ' + JSON.stringify(response.headers));
            Log.debug(getSessionInfo(req, res)+":"+'STATUS CODE: ' + response.statusCode);

            res.statusCode = response.statusCode;

            var body = '';

            response.on('data', function(data) {
                body += data;
            })

            response.on('end', function() {
                delete options.agent;

                var responseContentType = response.headers['content-type'];

                switch (true) {
                    case /application\/javascript/.test(responseContentType):
                    case /application\/json/.test(responseContentType):
                        Log.debug(getSessionInfo(req, res)+":"+util.inspect(body));
                        // body = JSON.parse(body);
                        break;
                    case /application\/xml/.test(responseContentType):
                    case /text\/xml/.test(responseContentType):
                    default:
                }

                // Set Headers and Call
                req.resultHeaders = response.headers;
                req.call = url.parse(options.host + options.path);
                req.call = url.format(req.call);

                // Response body
                req.result = body;

                Log.debug(getSessionInfo(req, res)+":"+'The body is ' + util.inspect(body));

                next();
            })
        }).on('error', function(e) {

                Log.debug(getSessionInfo(req, res)+":"+'HEADERS: ' + JSON.stringify(res.headers));
                Log.error(getSessionInfo(req, res)+":"+"Got error: " + e.message);
                Log.debug(getSessionInfo(req, res)+":"+"Error: " + util.inspect(e));

            });

        if (requestBody) {
            apiCall.end(requestBody, 'utf-8');
        }
        else {
            apiCall.end();
        }
    }
}

// Dynamic Helpers
// Passes variables to the view
app.dynamicHelpers({
    defaultParams: function(req, res) {
        Log.debug(getSessionInfo(req, res)+":"+"dynamicHelpers defaultParams");
        if(req.params.api && req.session[req.params.api] && req.session[req.params.api]['params'])
            return req.session[req.params.api]['params'];
    },
    defaultHeaders: function(req, res) {
        Log.debug(getSessionInfo(req, res)+":"+"dynamicHelpers defaultHeaders");
        if(req.params.api && req.session[req.params.api] && req.session[req.params.api]['headers'])
            return req.session[req.params.api]['headers'];
    },
    HelperParams: function(req, res) {
        Log.debug(getSessionInfo(req, res)+":"+"dynamicHelpers HelperParams");
        if(req.params.api && req.session[req.params.api] && req.session[req.params.api]['savedParams'])
            return req.session[req.params.api]['savedParams'];
    },
    HelperRequestBody: function(req, res) {
        Log.debug(getSessionInfo(req, res)+":"+"dynamicHelpers HelperRequestBody");
        if(req.params.api && req.session[req.params.api] && req.session[req.params.api]['savedRequestBody'])
            return req.session[req.params.api]['savedRequestBody'];
    },
    HelperHeaders: function(req, res) {
        Log.debug(getSessionInfo(req, res)+":"+"dynamicHelpers HelperHeaders");
        if(req.params.api && req.session[req.params.api] && req.session[req.params.api]['savedHeaders'])
            return req.session[req.params.api]['savedHeaders'];
    },
    session: function(req, res) {
        Log.debug(getSessionInfo(req, res)+":"+"dynamicHelpers session");
        // If api wasn't passed in as a parameter, check the path to see if it's there
        if (!req.params.api) {
            pathName = req.url.replace('/','');
            // Is it a valid API - if there's a config file we can assume so
            fs.stat(__dirname + '/public/data/' + pathName + '.json', function (error, stats) {
                if (stats) {
                    req.params.api = pathName;
                }
            });
        } else if(req.session[req.params.api]) {
            return req.session[req.params.api];
        }

        return req.session;
    },
    apiInfo: function(req, res) {
        Log.debug(getSessionInfo(req, res)+":"+"dynamicHelpers apiInfo");
        if (req.params.api) {
            return apisConfig[req.params.api];
        } else {
            return apisConfig;
        }
    },
    loginInfo:function(req, res) {
        Log.debug(getSessionInfo(req, res)+":"+"dynamicHelpers loginInfo");
        if(req.session.passport && req.session.passport.user)
            return req.session.passport.user;
    },
    authStatus: function(req, res) {
        Log.debug(getSessionInfo(req, res)+":"+"dynamicHelpers authStatus");
        var status = false;
        if(req.session[req.params.api] && req.session[req.params.api].authed)
            status=true;
        return status;
    },
    services: function(req, res) {
        Log.debug(getSessionInfo(req, res)+":"+"dynamicHelpers services");
        return apisConfig;
    },
    appConfig: function(req, res) {
        Log.debug(getSessionInfo(req, res)+":"+"dynamicHelpers appConfig");
        return config;
    },
    apiName: function(req, res) {
        Log.debug(getSessionInfo(req, res)+":"+"dynamicHelpers apiName");
        if (req.params.api) {
            return req.params.api;
        }
    },
    apiDefinition: function(req, res) {
        Log.debug(getSessionInfo(req, res)+":"+"dynamicHelpers apiDefinition");
        if (req.params.api) {
            var data = fs.readFileSync(__dirname + '/public/data/' + req.params.api + '.json');
            return JSON.parse(data);
        }
    },
    apiMetadata: function(req, res) {
        Log.debug(getSessionInfo(req, res)+":"+"dynamicHelpers apiMetadata");
        if (req.params.api) {
            var data = fs.readFileSync(__dirname + '/public/data/metadata/' + req.params.api + '.json');
            return JSON.parse(data);
        }
    }
})

app.helpers(require('./public/javascripts/helpers.js').helpers);

//
// Routes
//
app.get('/', function(req, res) {
    Log.debug(getSessionInfo(req, res)+":"+"received request for / ");
    res.render('listServices', {
        title: config.title
    });
});

// Process the API request
app.post('/processReq', saveRequest, oauth, processRequest, function(req, res) {
    Log.debug(getSessionInfo(req, res)+":"+"processed request for /processReq ");
    var result = {
        reqheaders: req.requestHeaders,
        resheaders: req.resultHeaders,
        response: req.result,
        call: req.call,
        code: req.res.statusCode
    };

    res.send(result);
});

app.post('/popup', handleCredentials, function(req, res){
    Log.debug(getSessionInfo(req, res)+":"+"processed request for /popup ");
    res.send({result: "saved"});
})

app.all('/popup/:api', function(req, res){
    Log.debug(getSessionInfo(req, res)+":"+"processed request for /popup/:api, rendering credentials");
    res.render('credentials', {layout:false});
})

app.all('/credential', handleCredentials, function(req, res){
    Log.debug(getSessionInfo(req, res)+":"+"processed request for /credential, redirect back ");
    res.redirect('back');
});

// OAuth callback page, closes the window immediately after storing access token/secret
app.get('/authSuccess/:api', oauthSuccess, function(req, res) {
    Log.debug(getSessionInfo(req, res)+":"+"processed request for /authSuccess/:api, rendering authSuccess ");
    res.render('authSuccess', {
        title: 'OAuth Successful',
        layout: false
    });
});

app.get('/openid/intuit',
    passport.authenticate('intuit', { failureRedirect: '/' }),
    function(req, res) {
        Log.debug(getSessionInfo(req, res)+":"+"processed request for /openid/intuit, redirecting to /");
        res.redirect('/');
    }
);

app.get('/openid/intuit/return',
    passport.authenticate('intuit', { failureRedirect: '/' }),
    function(req, res) {
        Log.debug(getSessionInfo(req, res)+":"+"processed request for /openid/intuit/return, redirecting to / ");
        if(req.session.passport.user)
            req.session.loggedin = true;
        res.redirect('/');
    }
);

app.post('/generatexml', function(req,res){
    Log.debug(getSessionInfo(req, res)+":"+"received request for /generateXML");
    Log.debug(getSessionInfo(req, res)+":"+'Going to fetch ' + req.body.apiName + '.json')
    var apiFile = fs.readFileSync(__dirname + '/public/data/' + req.body.apiName + '.json');
    Log.debug(getSessionInfo(req, res)+":"+'Fetched ' + req.body.apiName + '.json')
    var apiFile = JSON.parse(apiFile);
    Log.debug(getSessionInfo(req, res)+":"+'Parsed' + req.body.apiName + '.json')
    for(var i in apiFile.endpoints){
        var endpoint = apiFile.endpoints[i];
        if(endpoint.name == req.body.endpointName){
            for(var j in endpoint.methods){
                var method = endpoint.methods[j];
                if(method.MethodName == req.body.methodName){
                    if(method.RequestBodyEntity){
                        var str = generateXML(req.body.apiName, method.RequestBodyTemplate, method.RequestBodyEntity, method.RequestBodyExcludeElements);
                    }
                }
            }
        }
    }
    res.send(str);
});

app.get('/logout', function(req, res){
    req.session.loggedin = false
    req.logout();
    Log.debug(getSessionInfo(req, res)+":"+"processed request for /logout, redirecting back");
    res.redirect('back');
});

// API shortname, all lowercase
app.get('/:api([^\.]+)', getSavedInfo, function(req, res) {
    Log.debug(getSessionInfo(req, res)+":"+"processed request for /:api, rendering api");
    var apiName = req.params.api.replace(/\/$/,'');
    if(apisConfig[apiName].enabled && apisConfig[apiName].enabled == true) {
        req.params.api = apiName;
        res.render('api');
    } else {
        res.send(404);
    }
});

// Use the IntuitStrategy within Passport.
//   Strategies in passport require a `validate` function, which accept
//   credentials (in this case, an OpenID identifier and profile), and invoke a
//   callback with a user object.
passport.use(new IntuitStrategy({
        returnURL: 'http://'+config.address+':'+config.port+'/openid/intuit/return',
        realm: 'http://'+config.address+':'+config.port+'/'
    },
    function(identifier, profile, done) {
        // asynchronous verification, for effect...
        process.nextTick(function () {

            // To keep the example simple, the user's Intuit profile is returned to
            // represent the logged-in user.  In a typical application, you would want
            // to associate the Intuit account with a user record in your database,
            // and return that user instead.
            profile.identifier = identifier;
            return done(null, profile);
        });
    }
));

//if (!module.parent) {
    var port = process.env.PORT || config.port;
    app.listen(port);
    Log.debug("Express server listening on port " + port);
//}

// code to catch unhandled errors
process.on('uncaughtException', function(err) {
    console.log(err.stack);
});
