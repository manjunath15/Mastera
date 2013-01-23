var crypto = require('crypto');
var Dom = require('xmldom').DOMParser;
var https = require('https');
var tunnel = require('tunnel');
var URL= require('url');


var SAML = function (options) {
    this.options = this.initialize(options);
};

SAML.prototype.initialize = function (options) {
    if (!options) {
        options = {};
    }

    if (!options.path) {
        options.path = '/saml/consume';
    }

    return options;
};

SAML.prototype.generateUniqueID = function () {
    var current_date = (new Date()).valueOf().toString();
    var random = Math.random().toString();
    var uniqueId = crypto.createHash('md5').update(current_date + random).digest('hex');
    return uniqueId;
};


SAML.prototype.generateInstant = function(padding) {
    var date = new Date(Date.now() + padding);
    var dateUTCStr = date.getUTCFullYear() + '-' + ((date.getUTCMonth()+1)<10 ? '0'+ (date.getUTCMonth()+1): (date.getUTCMonth()+1))+ '-' +(date.getUTCDate()<10?'0'+date.getUTCDate():date.getUTCDate()) + 'T' + ((date.getUTCHours() < 10)? '0'+date.getUTCHours():date.getUTCHours()) + ":" + ((date.getUTCMinutes() < 10)? '0'+date.getUTCMinutes():date.getUTCMinutes()) + ":" + ((date.getUTCSeconds() < 10)? '0'+date.getUTCSeconds():date.getUTCSeconds()) + "." + ((date.getUTCMilliseconds() < 10)? '00'+date.getUTCMilliseconds():((date.getUTCMilliseconds() < 100)? '0'+date.getUTCMilliseconds():date.getUTCMilliseconds())) + "Z";

    return dateUTCStr;
};

SAML.prototype.createSignature = function(signedInfodata, callback){

    var signedInfo = '<ds:SignedInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">'+signedInfodata+'</ds:SignedInfo>';
    var signer = crypto.createSign("RSA-SHA1");
    signer.update(signedInfo);

    var extractedSigningKey = this.options.signingKey;

    var dataString = extractedSigningKey.toString();
    var startindex = dataString.indexOf('-----BEGIN RSA PRIVATE KEY-----');
    if(startindex < 0){
        startindex = dataString.indexOf('-----BEGIN PRIVATE KEY-----');
        if(startindex < 0){
            startindex = dataString.indexOf('-----BEGIN ENCRYPTED PRIVATE KEY-----');
            if(startindex >= 0){
                err = 'The given certificate file contains encrypted private key. Please provide valid certificate file (without encryption).';
                callback(err);
                return;
            }
        }
    }


    var endindex = dataString.indexOf('-----END RSA PRIVATE KEY-----');
    if(endindex < 0){
        endindex = dataString.indexOf('-----END PRIVATE KEY-----');
    }

    var str = extractedSigningKey;

    if(startindex > -1 && endindex > -1){
        str = dataString.substr(startindex , (endindex - startindex) + 35);
    } else {
        err = 'The given certificate file is not supported. Please provide valid PEM certificate file.';
        callback(err);
        return;
    }

    var signatureValue = signer.sign(str, output_format='base64')

    var signature = '<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:SignedInfo>' + signedInfodata + '</ds:SignedInfo><ds:SignatureValue>' +
        signatureValue + '</ds:SignatureValue></ds:Signature>';

    callback(null, signature);
    return;

}

SAML.prototype.generateAuthorizeRequest = function (callback) {
    var id = "_" + this.generateUniqueID();

    var notBeforeInstant = this.generateInstant(-6000);
    var authenInstant = this.generateInstant(0);
    var issueInstant = this.generateInstant(0);
    var notOnorAfterInstant = this.generateInstant(60000);

    var request =
        '<saml2:Assertion xmlns:saml2="urn:oasis:names:tc:SAML:2.0:assertion" ID="' + id + '" IssueInstant="' + issueInstant + '" Version="2.0">' +
            '<saml2:Issuer>' + this.options.issuer + '</saml2:Issuer>' +
            '<saml2:Subject><saml2:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified">' + this.options.subject + '</saml2:NameID>' +
            '<saml2:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"></saml2:SubjectConfirmation></saml2:Subject>' +
            '<saml2:Conditions NotBefore="' + notBeforeInstant + '" NotOnOrAfter="' + notOnorAfterInstant + '">' +
            '<saml2:AudienceRestriction><saml2:Audience>' + this.options.issuer + '</saml2:Audience></saml2:AudienceRestriction></saml2:Conditions>' +
            '<saml2:AuthnStatement AuthnInstant="' + authenInstant + '" SessionIndex="' + id + '"><saml2:AuthnContext>' +
            '<saml2:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:unspecified</saml2:AuthnContextClassRef>' +
            '</saml2:AuthnContext></saml2:AuthnStatement></saml2:Assertion>';

    var digestValue = this.generateDigestValue(request);

    var signedInfodata =
        '<ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"></ds:CanonicalizationMethod>' +
        '<ds:SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></ds:SignatureMethod>' +
        '<ds:Reference URI="#' + id + '">' +
        '<ds:Transforms>' +
        '<ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></ds:Transform>' +
        '<ds:Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"></ds:Transform>' +
        '</ds:Transforms>' +
        '<ds:DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></ds:DigestMethod>' +
        '<ds:DigestValue>' + digestValue + '</ds:DigestValue>' +
        '</ds:Reference>';


    var signature;
    this.createSignature(signedInfodata, function(err, sign){
        if(err){
            callback(err);
        } else {
            signature = sign;
        }
    });

    if(!signature){
        return;
    }
    var signatureXml = new Dom().parseFromString(signature);

    var xml = new Dom().parseFromString(request);
    var firstChild = xml.documentElement.firstChild.nextSibling;
    xml.documentElement.insertBefore(signatureXml.documentElement,firstChild);

    var finalStr = xml.toString();
    var finalxml = '<?xml version="1.0" encoding="UTF-8"?>'+finalStr;
    callback(null, finalxml);
};

SAML.prototype.generateDigestValue = function(data){
    var digestValue = crypto.createHash('sha1').update(data, 'utf8').digest('base64');
    return digestValue;
}

SAML.prototype.parseResponse = function(res){
    var params = res.split("&");
    var ret = new Object();
    for(var i in params){
        var data = params[i].split("=");
        ret[data[0]]=data[1];
    }
    return ret;
}

SAML.prototype.getResponse = function(callback){
    var requestStr = null;
    this.generateAuthorizeRequest(function(err, reqStr){
        if(err){
            callback(err);
        } else {
            requestStr = reqStr;
        }
    });

    if(!requestStr)
        return;

    var encodedStr = new Buffer(requestStr).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    var payload = 'saml_assertion=' + encodedStr;

    var parsedUrl= URL.parse( this.options.url, false );
    if( parsedUrl.protocol == "http:" && !parsedUrl.port ) parsedUrl.port= 80;
    if( parsedUrl.protocol == "https:" && !parsedUrl.port ) parsedUrl.port= 443;

    if( !parsedUrl.pathname  || parsedUrl.pathname == "" ) parsedUrl.pathname ="/";

    var consumerKey = this.options.consumerKey;
    var post_options = {
        host: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname,
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': payload.length,
            'Content-Language': 'en-US',
            'Authorization': 'OAuth oauth_consumer_key="' + consumerKey + '"'
        }
    };

    if(this.options.proxy){
        var tunnelingAgent = tunnel.httpsOverHttp({
            proxy: this.options.proxy
        });
        post_options['agent']= tunnelingAgent;
    }

    var post_req = https.request(post_options, function(res) {
        res.setEncoding('utf8');
        res.on('data', function (chunk) {
             callback(null, chunk);
        });
    });

    post_req.write(payload);
    post_req.end();
}

module.exports = SAML;


