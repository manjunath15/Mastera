exports.helpers = {
    formattedXML: function(str) {
        var xml = '';

        // add newlines
        str = str.replace(/(>)(<)(\/*)/g,"$1\r$2$3");

        // add indents
        var pad = 0,
            indent,
            node;

        // split the string
        var strArr = str.split("\r");

        // check the various tag states
        for (var i = 0, len = strArr.length; i < len; i++) {
            indent = 0;
            node = strArr[i];

            if (node.match(/.+<\/\w[^>]*>$/)) { //open and closing in the same line
                indent = 0;
            } else if (node.match(/^<\/\w/) && pad > 0) { // closing tag
                pad -= 1;
            } else if (node.match(/^<\w[^>]*[^\/]>.*$/)) { //opening tag
                indent = 1;
            } else {
                indent = 0;
            }

            xml += spaces(pad) + node + "\r";
            pad += indent;
        }

        return xml;
    },

    restrictCellData: function(str, padding) {
        var len = 10;
        if(padding == 5) {
            len = 25;
        } else if(padding == 20) {
            len = 20;
        } else if(padding == 35) {
            len = 15;
        } else if(padding >= 50) {
            len = 10;
        }

        if(str.length > len) {
            str = str.substr(0, len - 3) + "...";
        }
        return str;
    }

};

function spaces(len) {
    var s = '',
        indent = len * 4;

    for (var i = 0; i < indent;i++) {
        s += " ";
    }

    return s;
}



