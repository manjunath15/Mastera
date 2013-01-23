(function() {

    // Display only the first entity
    var contentObject = $('div.contentArea').get(0);
    contentObject.style.display = 'block';

    // Paint the first entity as selected
    var entityObject = $('li.entityClass a').get(0);
    entityObject.className = 'selected';

    // Toggle all API methods
    $('div.actionBlocks').find('form.hidden').toggle();

    // Toggle all attribute blocks
    $('div.attributesLayout').find('div.attributesContent').toggle();

    // By default all the entities are visible. First Toggle all content area.
    //$('.contentArea').css('display','none');

    // Display only the first entity
    var contentObject = $('div.contentArea').get(0);
    contentObject.style.display = 'block';

    // Paint the first entity as selected
    var entityObject = $('li.entityClass a').get(0);
    entityObject.className = 'selected';

    // Method to expand the api methods
    function listMethods(context) {
        var methodsList = $('ul.methods', context || null);

        for (var i = 0, len = methodsList.length; i < len; i++) {
            $(methodsList[i]).slideDown();
        }
    }

    // OnChange of service
    $('div.menu select').change(function() {
        location.href = '/'+this.value;
    })

    // Toggle an entity
    $('li.entityClass a').click(function() {
        $('.contentArea.hide').css('display','none');
        var index = $('li.entityClass a').index(this);
        var contentObject = $('div#contentAreaId'+index);
        contentObject.css('display', 'block');

        $('div.attributesLayout').find('div.attributesContent').toggle();
        $('div.actionBlocks').find('form.hidden').toggle();
        $('li.entityClass a.selected').removeClass();
        $(this).addClass('selected');
    })

    // Toggle a method when click on action button
    $('div.titleSection a.actionButton').click(function() {
        $('form', $(this).closest('div.actionBlock')).slideToggle();
    })

    // Toggle a method when click on action link
    $('div.titleSection a.actionLink').click(function() {
        $('form', $(this).closest('div.actionBlock')).slideToggle();
    })

    // Toggle attribute when click on attribute button
    $('div.attributesLayout a.attributesHeader').click(function() {
        $('div.attributesContent', $(this).closest('div.attributesLayout')).slideToggle();
    })

    // List methods for a particular endpoint.
    // Hide all forms if visible
    $('li.list-methods a').click(function(event) {
        event.preventDefault();
        // Make sure endpoint is expanded

        var endpoint = $(this).closest('div.contentArea');
        var methods = $('div.actionBlock form', endpoint);

        listMethods(endpoint);

        // Make sure all method forms are collapsed
        var visibleMethods = $.grep(methods, function(method) {
            return $(method).is(':visible')
        })

        $(visibleMethods).each(function(i, method) {
            $(method).slideUp();
        })

    })

    // Expand methods for a particular endpoint.
    // Show all forms and list all methods
    $('li.expand-methods a').click(function(event) {
        event.preventDefault();

        // Make sure endpoint is expanded
        var endpoint = $(this).closest('div.contentArea');
        var methods = $('div.actionBlock form', endpoint);

        listMethods(endpoint);

        // Make sure all method forms are expanded
        var hiddenMethods = $.grep(methods, function(method) {
            return $(method).not(':visible')
        })

        $(hiddenMethods).each(function(i, method) {
            $(method).slideDown();
        })

        $(endpoint).toggleClass('expanded', true);

    });

    // Toggle headers section
    $('div.headers h4').click(function(event) {
        event.preventDefault();

        $(this.parentNode).toggleClass('expanded');

        $('div.fields', this.parentNode).slideToggle();
    });

    // Auth with OAuth
    $('#credentials').submit(function(event) {
        var self = this;
        event.preventDefault();

        // remove error messgae if exists
        var credentials = $('section.credentials form');
        $('div.error', credentials).remove();

        // loader
        $(document.createElement('img'))
            .attr('src','/images/loader.gif')
            .attr('id','oauth_loader')
            .addClass('loader')
            .attr('style', 'padding-left:10px;')
            .insertAfter($('input[type=submit]', self));

        var params = $(this).serializeArray();

        var submit = { name: 'submit', value: $('input[name=submit]').val() };

        params.push(submit);

        $.post('/credential', params, function(result) {
            if (result.signin) {
                window.open(result.signin,"_blank","height=900,width=800,menubar=0,resizable=1,scrollbars=1,status=0,titlebar=0,toolbar=0");
            } else if(result.err) {
                var credentials = $('section.credentials form');
                credentials.append($(document.createElement('div')).attr('class', 'error').text(result.err));
            } else {
                location.reload(true);
            }

        }).error( function(err, text){
            var credentials = $('section.credentials form');
            credentials.append($(document.createElement('div')).attr('class', 'error').text(err.responseText));
        }).complete(function(result, text) {
            $('#oauth_loader',self).remove();
        });
    });

    /*
        Try it! button. Submits the method params, apikey and secret if any, and apiName
    */
    $('div.actionBlock form').submit(function(event) {
        var self = this;

        event.preventDefault();

        var params = $(this).serializeArray(),
            apiKey = { name: 'apiKey', value: $('input[name=key]').val() },
            apiSecret = { name: 'apiSecret', value: $('input[name=secret]').val() },
            apiName = { name: 'apiName', value: $('input[name=apiName]').val() },
            endpointName = { name: 'endpointName', value: $('input[name=endpointName]').val() };

        params.push(apiKey, apiSecret, apiName);

        // Setup results container
        var resultContainer = $('.result', self);
        if (resultContainer.length === 0) {
            resultContainer = $(document.createElement('div')).attr('class', 'result');
            $(self).append(resultContainer);
        }

        if ($('pre.response', resultContainer).length === 0) {

            // Clear results link
            var clearLink = $(document.createElement('a'))
                .text('Clear results')
                .addClass('clear-results')
                .attr('href', '#')
                .click(function(e) {
                    e.preventDefault();

                    var thislink = this;
                    $('.result', self)
                        .slideUp(function() {
                            $(this).remove();
                            $(thislink).remove();
                        });
                })
                .insertAfter($('input[type=submit]', self));

            // loader
            var loader = $(document.createElement('img'))
                .attr('src','/images/loader.gif')
                .attr('id','loader')
                .addClass('loader')
                .insertAfter($('input[type=submit]', self));

            // Call that was made, add pre elements
            resultContainer.append($(document.createElement('h4')).text('Request URI'));
            resultContainer.append($(document.createElement('pre')).addClass('call'));

            // Request Header
            resultContainer.append($(document.createElement('h4')).text('Request Headers'));
            resultContainer.append($(document.createElement('pre')).addClass('reqheaders prettyprint'));

            // Code
            resultContainer.append($(document.createElement('h4')).text('Response Code'));
            resultContainer.append($(document.createElement('pre')).addClass('code prettyprint'));

            // Response Header
            resultContainer.append($(document.createElement('h4')).text('Response Headers'));
            resultContainer.append($(document.createElement('pre')).addClass('resheaders prettyprint'));

            // Response
            resultContainer.append($(document.createElement('h4'))
                .text('Response Body')
                .append($(document.createElement('a'))
                    .text('Select body')
                    .addClass('clear-results')
                    .attr('href', '#')
                    .click(function(e) {
                        e.preventDefault();
                        selectElementText($(this.parentNode).siblings('.response')[0]);
                    })
                )
            );
            resultContainer.append($(document.createElement('pre')).addClass('response prettyprint'));
        }

        $.post('/processReq', params, function(result, text) {
            // If we get passed a signin property, open a window to allow the user to signin/link their account
            if (result.signin) {
                window.open(result.signin,"_blank","height=900,width=800,menubar=0,resizable=1,scrollbars=1,status=0,titlebar=0,toolbar=0");
            } else {
                var response
                if(result.headers && result.headers['content-type']){
                    var responseContentType = result.headers['content-type'];
                    // Format output according to content-type
                    response = livedocs.formatData(result.response, result.headers['content-type']);
                }else if(result.err) {
                    $('pre.response', resultContainer)
                        .toggleClass('error', true);
                }
            }

        })
        // Complete, runs on error and success
        .success(function(result, text) {
            //var response = JSON.parse(result.responseText);
            response = result;
            console.log("in success")
            if(response.response){
                var responseBody;
                if(response.resheaders && response.resheaders['content-type']){
                    responseBody = livedocs.formatData(response.response, response.resheaders['content-type']);
                } else {
                    responseBody = response.response;
                }

                $('pre.response', resultContainer)
                    .text(responseBody);
            }

            if (response.call) {
                $('pre.call', resultContainer)
                    .text(response.call);
            }

            if (response.reqheaders) {
                $('pre.reqheaders', resultContainer)
                    .text(formatJSON(response.reqheaders));
            }

            if (response.code) {
                $('pre.code', resultContainer)
                    .text(response.code);
            }

            if (response.resheaders) {
                $('pre.resheaders', resultContainer)
                    .text(formatJSON(response.resheaders));
            }

            // Syntax highlighting
            // prettyPrint();
        })
        .error(function(result, text) {
            console.log(result);
            var textblock = "";
            var response;
            try {
                if(result.responseText){
                    response = JSON.parse(result.responseText);
                }
                else
                    response = result;
                if(response.response && response.resheaders['content-type']){
                    textblock = livedocs.formatData(response.response, response.resheaders['content-type']);
                } else {
                    if(result.statusText) {
                        textblock = 'Browser is handling response and has thrown error with message: ' + result.statusText;
                    } else {
                        textblock = 'Error';
                    }
                }
                if (response.call) {
                    $('pre.call', resultContainer)
                        .text(response.call);
                }

                if (response.reqheaders) {
                    $('pre.reqheaders', resultContainer)
                        .text(formatJSON(response.reqheaders));
                }

                if (response.code) {
                    $('pre.code', resultContainer)
                        .text(response.code);
                } else if(result.status != -1) {
                    $('pre.code', resultContainer)
                        .text("Browser is handling response and has returned with status code: " + result.status);
                }

                if (response.resheaders) {
                    $('pre.resheaders', resultContainer)
                        .text(formatJSON(response.resheaders));
                }
            } catch(error){
                textblock = result.responseText;
            }
            $('pre.response', resultContainer)
                .toggleClass('error', true)
                .text(textblock);

            // Syntax highlighting
            // prettyPrint();
        })
        .complete(function(result, text) {
            $('#loader',self).remove();
        });
    })

    $('a.xmlgenerator').click(function(){
        var formObj = $(this).parents('form:first');

        var params = $(this).serializeArray(),
            apiName = { name: 'apiName', value: $('input[name=apiName]').val() },
            endpointName = { name: 'endpointName', value: $('input[name=endpointName]', formObj).val() },
            methodName = { name: 'methodName', value: $('input[name=methodName]', formObj).val() };
        params.push(apiName,endpointName,methodName);

        $.post('/generatexml', params, function(result, text) {
            var requestBody = $('textarea[name=requestBody]', formObj);
            var formattedData = formatXML(result);
            formattedData = formattedData.replace(/\> \<\//g, '></');
            requestBody.val(formattedData);
        })
    })

    $('#popup-link').click(function(){
        openCredentialsPopup();
    })

})();

function openCredentialsPopup() {
    var apiName = $('input[name=apiName]').val();
    window.open('/popup/'+apiName,"_blank","height=600,width=730,menubar=0,resizable=no,scrollbars=1,status=0,titlebar=0,toolbar=0");
}
