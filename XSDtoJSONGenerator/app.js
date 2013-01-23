var fs = require('fs'),
    path = require('path');
    sax = require('sax');

var ComplexTypeList,// Maintains the List of ComplexType parsed
    ElementList,    // Maintains the List of Root Elements parsed
    fileRead;       // Maintains the List of Files parsed

//SAX module, parses the xml and push the node to stack
function parseString(data, cb){

    var stack = [];
    var saxParser = sax.parser(true, {
        trim: false,
        normalize: false
    });

    saxParser.onerror = function(error) {
        console.log(error);
        if (!err) {
            err = true;
            return _this.emit("error", error);
        }
    };

    saxParser.onopentag = function(node) {
        //console.log("Opentag " + node.name);
        stack.push(node);
    };

    saxParser.onclosetag = function() {
        //console.log("Closetag ");
        var obj = stack.pop();
        var s = stack[stack.length - 1];
        if(s){
            if(s['child']==undefined){
                s['child']=[];
            }
            s['child'].push(obj);
        }else{
            stack.push(obj);
        }
    };

    saxParser.ontext = saxParser.oncdata = function(text) {
        var txt = text.trim();
        var s = stack[stack.length - 1];
        if(s && txt){
            s['text']=txt;
        }
    };

    saxParser.onend = function(){
        var err = null;
        if ((cb != null) && typeof cb === "function") {
            cb(err,stack);
        }
    };

    var output =  saxParser.write(data.toString());
    saxParser.close();
};

//inserts namespace in complexType / element JSON
function findNamespace(namespaceList, ele){
    if(namespaceList['targetNamespace']){
        ele['namespace']=namespaceList['targetNamespace'];
    }
    return;
}

//XSD parser
//creates array structure of xml nodes with
//child - containing siblings
//attributes - containing attributes of node
//name - name of node
function processXSD(filename){

    var data = fs.readFileSync(filename);
    console.log("parsing "+filename);
    parseString(data, function (err, result) {

        //push the filename in fileRead array marking that this file is parsed and complexTypes are included in ComplexTypeList
        fileRead.push(filename);

        //check if xs:schema has any child nodes
        if(result[0] && result[0]['child']){
            //loop through all the child nodes of xs:schema
            for (var i in result[0]['child']){
                var node = result[0]['child'][i];
                //we are handling xs:include, xs:import, xs:group, xs:complexType and xs:element
                if(node.name=='xs:include' || node.name=='xs:import'){
                    var filetoread = path.resolve(path.dirname(filename),node.attributes.schemaLocation);
                    if(fileRead.indexOf(filetoread) == -1) {
                        processXSD(filetoread);
                    }
                }else if(node.name=='xs:group'){
                    var attr = [];
                    //parse Group and get attributes for block
                    handleGroup(result, node, attr);

                    //initialize block for new definitions and insert the namespace, then insert attributes of this block
                    var block = {};
                    findNamespace(result[0].attributes, block);
                    block['attributes']=attr;

                    //add the block to ComplexTypeList
                    ComplexTypeList[node.attributes.name]=block;
                }else if(node.name=='xs:complexType'){
                    var attr = [];

                    //parse complexType and get attributes for block
                    handleComplexType(result, node, attr);

                    //initialize block for new definitions and insert the namespace, then insert attributes of this block
                    var block = {};
                    findNamespace(result[0].attributes, block);
                    block['attributes']=attr;

                    //add the block to ComplexTypeList
                    ComplexTypeList[node.attributes.name]=block;

                }else if(node.name=='xs:element'){
                    // This is a Root Element (just after the schema node)
                    var attr = [];

                    //parse element and get attributes for block
                    handleRootElement(result, node, attr);

                    //root element will refer to other complextypes of elements
                    var block = {};
                    findNamespace(result[0].attributes, block);
                    block['attributes']=attr;

                    ElementList[node.attributes.name]=block;
                }
            }
        }
    });
}

//function for handling ComplexType
function handleComplexType(root, obj, attr){
    for(var i in obj.child){
        //loop through all the child nodes and recursively parse them
        var node=obj.child[i];
        if(node.name=='xs:complexContent'){
            handleComplexContent(root, node, attr);
        }else if(node.name=='xs:group'){
            handleGroup(root, node, attr);
        } else if(node.name=='xs:all'){
            // handle complexType - all
        } else if(node.name=='xs:choice'){
            handleChoice(root, node, attr);
        } else if(node.name=='xs:sequence'){
            handleSequence(root, node, attr);
        } else if(node.name=='xs:attribute'){
            // handle complexType - attribute
        } else if(node.name=='xs:attributeGroup'){
            // handle complextype - attributeGroup
        }
    }
}

//function to parse ComplexContent
function handleComplexContent(root, obj, attr){
    var node = obj.child[0];
    //ComplexContent can have extention or restriction child nodes
    if(node.name=='xs:extension'){
        handleExtention(root, node, attr);
    }else if(obj['xs:restriction']){
        // handle complexContent - restriction
    }
}

//function to parse Extention
function handleExtention(root, obj, attr) {
    //this denotes extention of complexContent. lookup the base complexType and bring its attributes here then add extended attributes
    lookup(root, obj.attributes.base, attr);

    for(var i in obj.child){
        var node=obj.child[i];
        if(node.name=='xs:group'){
            handleGroup(root, node, attr);
        } else if(node.name=='xs:all'){
            // handle extention all
        } else if(node.name=='xs:choice'){
            handleChoice(root, node, attr);
        } else if(node.name=='xs:sequence'){
            handleSequence(root, node, attr);
        } else if(node.name=='xs:attribute'){
            // handle extention attribute
        } else if (node.name=='xs:attributeGroup'){
            // handle extention attributeGroup
        }
    }
    return;
}

//function to parse Sequence
function handleSequence(root, obj, attr){
    for(var i in obj.child){
        //loop through all the child nodes and recursively parse them
        var node=obj.child[i];
        if(node.name=='xs:element'){
            handleElement(root, node, attr);
        }else if(node.name=='xs:group'){
            handleGroup(root, node, attr);
        }else if(node.name=='xs:choice'){
            handleChoice(root, node, attr);
        }else if(node.name=='xs:sequence'){
            handleSequence(root, node, attr);
        }
    }
    return;
}

//function to parse root element (child node of xs:schema)
function handleRootElement(root, obj, attr){
    //name attribute should always be present for root element

    var ele = {};
    if(obj.attributes.name){
        ele['name']= obj.attributes.name;
    }
    //specified the name of built-in type / simpleType / complexType
    if(obj.attributes.type){
        ele['type']= obj.attributes.type;
    }

    //substitutionGroup specifies the name of an element that can be substituted with this element. Will be present for only root element.
    if(obj.attributes.substitutionGroup){
        ele['substitution']=obj.attributes.substitutionGroup;
    }

    //parse built-in types
    for(var i in obj.child){
        var node = obj.child[i];
        //annotation will have the documentation for this element
        if(node.name=='xs:annotation'){
            handleAnnotation(root, node, ele);
        }else if(node.name=='xs:simpleType'){
            //for restriction / list / union of simpleType, the name of referred type is in base attribute
            if(node.child[0].name=='xs:restriction' || node.child[0].name=='xs:list' || node.child[0].name=='xs:union'){
                ele['type']=node.child[0].attributes.base;
            }
        }else if(node.name=='xs:complexType'){
            //parse built-in complexType, and add the complexType parsed to the complexTypeList
            var childattr = [];
            var childblock = {};

            handleComplexType(root, node, childattr);

            findNamespace(root[0].attributes, childblock);
            childblock['attributes']=childattr;

            ComplexTypeList[obj.attributes.name]=childblock;
            //link the parsed complexType in current complexType
            ele['name']=obj.attributes.name;
            ele['type']=obj.attributes.name;

        }else if(node.name=='xs:unique'){
            // handle element unique
        }else if(node.name=='xs:key'){
            // handle element key
        }else if(node.name=='xs:keyref'){
            // handle element keyref
        }
    }
    attr.push(ele);
}

//function to parse Element (which is not immidiate child of xs:schema)
function handleElement(root, obj, attr){
    //this is element that is defined in complexTypes
    var ele = {};

    //either ref or name should be present
    if(obj.attributes.type || obj.attributes.name){
        if(obj.attributes.name){
            ele['name']= obj.attributes.name;
        }
        if(obj.attributes.type){
            ele['type']= obj.attributes.type;

        }
        if(obj.attributes.minOccurs && obj.attributes.minOccurs!='0')
            ele['required']=true;

    }else if(obj.attributes.ref){
        ele['name']=splitName(obj.attributes.ref);
        ele['type']=obj.attributes.ref;
    }

    //loop through all the child nodes and recursively parse them
    for(var i in obj.child){
        var node = obj.child[i];
        if(node.name=='xs:annotation'){
            handleAnnotation(root, node, ele);
        }else if(node.name=='xs:simpleType'){
            //if simpleType is having restriction, list or union, set the type for this attribute as the value of base
            if(node.child[0].name=='xs:restriction' || node.child[0].name=='xs:list' || node.child[0].name=='xs:union'){
                ele['type']=node.child[0].attributes.base;
            }
        }else if(node.name=='xs:complexType'){
            //if complexType, parse the complexType recursively and add the parsed Complex Type to complexTypeList and
            // set the name and type of this attribute as the name of complexType
            var attr1 = [];
            handleComplexType(root, node, attr1);
            var ele1 = {};
            findNamespace(root[0].attributes, ele1);
            ele1['attributes']=attr1;
            ComplexTypeList[obj.attributes.name]=ele1;
            ele['name']=obj.attributes.name;
            ele['type']=obj.attributes.name;
        }else if(node.name=='xs:unique'){
            // handle element unique
        }else if(node.name=='xs:key'){
            // handle element key
        }else if(node.name=='xs:keyref'){
            // handle element keyref
        }
    }
    attr.push(ele);
}

//function to handle Group
function handleGroup(root, node, attr){

    //lookup the group and bring its attributes here then add extended attributes
    if(node.attributes && node.attributes.ref){
        lookup(root, node.attributes.ref, attr)
    }

    //group can have (all,choice or sequence) zero or one time
    for(var i in node.child){
        var obj=node.child[i];
        if(obj.name=='xs:all'){
            // handle group all
        }else if(obj.name=='xs:choice'){
            handleChoice(root, obj, attr);
        }else if(obj.name=='xs:sequence'){
            handleSequence(root, obj, attr);
        }
    }
}

//function to handle Choice
function handleChoice(root, node, attr){
    //choice can have (element, group, choice or sequence) zero or more times
    for(var i in node.child){
        //loop through all the child nodes and recursively parse them
        var obj=node.child[i];
        if(obj.name=='xs:element'){
            handleElement(root, obj, attr);
        }else if(obj.name=='xs:group'){
            handleGroup(root, obj, attr);
        }else if(obj.name=='xs:choice'){
            handleChoice(root, obj, attr);
        }else if(obj.name=='xs:sequence'){
            handleSequence(root, obj, attr);
        }
    }
}

//function to handle Annotation.
function handleAnnotation(root, obj, ele){
    //annotation have documentation as child node
    if(obj.child && obj.child[0].name=='xs:documentation'){
        if(obj.child[0].text)
            ele['synopsis']=  obj.child[0].text;
    }
}

//this function lookup the attributes and pass them back to be extended
function lookup(root, obj, attr){
    var key = obj.split(':');
    if(key.length > 1)
        key = key[1];
    else
        key = obj;

    if(ComplexTypeList[key]){
        //if complexType with this name is already parsed, loop through all the attributes and copy them for current block
        for(var i in ComplexTypeList[key]['attributes']){
            attr.push(ComplexTypeList[key]['attributes'][i]);
        }
        return true;
    }

    //if complexType with this name is not already parsed, find it in current file
    // (complexTypes in imported or included xsd would already have been parsed and included in ComplexTypeList)
    if(root[0] && root[0]['child']){
        for (var i in root[0]['child']){
            var node = root[0]['child'][i];
            if(node.name=='xs:group' && node.attributes && node.attributes.name==key){
                var attr1 = [];
                handleGroup(root, node, attr1);
                var ele1 = {};
                findNamespace(root[0].attributes, ele1);
                ele1['attributes']=attr1;
                ComplexTypeList[node.attributes.name]=ele1;
                attr1.forEach(function(leaf){
                    attr.push(leaf);
                });
                 return true;
            }else if(node.name=='xs:complexType' && node.attributes && node.attributes.name==key){
                var attr1 = [];
                handleComplexType(root, node, attr1);
                var ele1 = {};
                findNamespace(root[0].attributes, ele1);
                ele1['attributes']=attr1;
                ComplexTypeList[node.attributes.name]=ele1;
                attr1.forEach(function(leaf){
                    attr.push(leaf);
                });
                return true;
            }
        }
    }
    return false;
}

/*//not using it right now ... might be needed in future
function mergeElementList(){
    ComplexTypeList['Root_Elements']=ElementList;
}
*/
//function to extract name
function splitName(elename){
    var name = elename.split(':');
    if (name.length > 1)
        return name[1];
    else
        return elename;
}

// main program starts here
var dirs, directory, basePath;
var configJSON = fs.readFileSync(__dirname +'/config.json');
var config = JSON.parse(configJSON.toString());

for(var name in config){
    //loop through all the configuration in config.json and parse them one by one
    //intialize complexTypeList, ElementList and fileRead for current service being parsed
    ComplexTypeList = {};
    ElementList = {};
    fileRead = [];

    //if basePath is set use them other wise take the current path of application as base path
    var api = config[name];
    basePath = api.basePath;
    if(!basePath){
        basePath=__dirname;
    }

    //if path is set append it to the base path to construct complete path
    if(api.path)
        directory = basePath + '/' + api.path;
    else
        directory = basePath;

    //read the content of directory
    dirs = fs.readdirSync(directory);

    dirs.forEach(function(file){
        //loop through all the files and check its extention (should be .xsd)
        var ext = path.extname(file);
        if(ext === '.xsd'){
            //check if file is not already parsed
            if(fileRead.indexOf(file) == -1){
                var filepath = path.resolve(directory,file);
                //start the parsing process
                processXSD(filepath);
            }
        }
    })

    //mergeElementList();

    //save generated JSON structure
    var output = api.output;

    outBasePath = output.basePath;
    if(!outBasePath){
        outBasePath=__dirname;
    }

    outDirectory = outBasePath + '/' + output.path;

    if(!fs.existsSync(outDirectory)){
        fs.mkdirSync(outDirectory);
    }
    fs.writeFile(path.resolve(outDirectory,output.name),JSON.stringify(ComplexTypeList,null,2), function(err){
        if(err) throw err;
        console.log("file saved");
    });
}

console.log('done');





