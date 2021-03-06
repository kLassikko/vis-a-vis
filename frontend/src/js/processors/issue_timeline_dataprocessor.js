/*
* Copyright (c) TUT Tampere University of Technology 2014-2015.
* All rights reserved.
* This software has been developed in Tekes-TIVIT project Need-for-Speed.
* All rule set in consortium agreement of Need-for-Speed project apply.
*
* Main authors: Antti Luoto, Anna-Liisa Mattila, Henri Terho
*/

//Data processor for event timeline chart
//Filters can be used to query data based on e.g. origin or time frame. NOT YET IMPLEMENTED!
//mapping is to determine which field of construct is used as a Y axis index values
//if anonymize flag is set to true the Y axis index values are anonymized using the base string provided
//in astring parameter and order number. If no base string is provided only order numbers are used to anonymize the ids.
var ISSUE_TIMELINE_PROCESSOR = function(par){
    
    var p = par || {};
    
    var _rowId = p.rowId !== undefined ? p.rowId : "_id";
    var _fromOrigin = p.rowIdIsFromOrigin !== undefined ? p.rowIdIsFromOrigin : false;
    var _anonymize = p.anonymize !== undefined ? p.anonymize : false;
    var _astring = p.astring !== undefined ? p.astring : "";
    var _states = p.states !== undefined ? p.states : {};
    
    if(!_states.start){
        _states.start = [];
    }
    if(!_states.intermediate){
        _states.intermediate = [];
    }
    if(!_states.resolution){
        _states.resolution = [];
    }
    
    //Splitting the Y-index mapping from . so we can do the mapping properly
    //even if it is a field of nested object.
    _rowId = _rowId.split(".");
    
    //Sorts event based on time
    // if the timestamps are the same start events are allways smaller than other events
    // and close events are allways larger than other events
    // if both events have the same timestamp and are both start or close events or neither of them
    // the ordering is done based on rowid (alphabetically)
    var eventSortFunction = function(e1, e2){
        var t1 = new Date(e1.time).getTime();
        var t2 = new Date(e2.time).getTime();
        if(t1 === t2){
            
            var start1 = _states.start.indexOf(e1.type);
            var start2 = _states.start.indexOf(e2.type);
            
            var closed1 = _states.resolution.indexOf(e1.type);
            var closed2 = _states.resolution.indexOf(e2.type);
            
            if(start1 !== -1 && start2 === -1){
                return -1;//e1 is smaller as it is start event and e2 is not
            }
            else if(start2 !== -1 && start1 === -1){
                return 1;//e2 is smaller as it is start event and e1 is not
            }
            else if(closed1 !== -1 && closed2 === -1){
                return 1;//e2 is smaller as it is not resolution event and e1 is
            }
            else if(closed2 !== -1 && closed1 === -1){
                return -1;//e1 is smaller as it is not resolution event and e2 is
            }
            else{
                if(e1.rowId !== undefined && e2.rowId !== undefined){
                    return e1.rowId.localeCompare(e2.rowId);
                }
                else if(e1.rowId !== undefined){
                    return -1;
                }
                else if(e2.rowId !== undefined){
                    return 1;
                }
                else{
                    return 0;
                }
            }
            
            
            
        }
        return t1-t2;
    };
    
    
    var parseLifespans = function(states){
        var lifespans = [];
        for(var rid in states){
            if(states.hasOwnProperty(rid)){
                var constructStates = states[rid];
                if(constructStates.length === 0){
                    continue;
                }
                //sorting the events based on the event time
                //this way we can just take the first event as the start event and
                //we can allways assume that the next event is chronologically behind the first event
                constructStates.sort(eventSortFunction);

                //We assume that the first event in time is the open event
                var st = constructStates[0].time; //start time
                var state = constructStates[0].state; //state we are in
                var rt = false;//resolution time
                
                //skip flag which is used for not to draw states
                //between resolution state and next start state e.g. in cases of reopened issues
                var skip = false;
                //however if the first state wasn't start state then we go into skip mode.
                if(_states.start.indexOf(state.replace(/\s/g,'')) === -1){
                    skip = true;
                }
                
                //as the order has to be preserved normal for-loop is used
                for(var j = 1; j < constructStates.length; ++j){
                    var c = constructStates[j];
                    var trimmedState = c.state.replace(/\s/g,'');

                    if(!skip){
                        var tmp = {
                            rowId : rid,
                            start : st,
                            state : state,
                            end : c.time
                        };
                        lifespans.push(tmp);
                        st = c.time;
                        state = c.state;
                    }
                    
                    //If we are in skip mode we wait next start state
                    if(skip){
                        //If we found the start state we come out from skip mode and assign new start time and state
                        if(_states.start.indexOf(trimmedState) !== -1){
                            st = c.time;
                            state = c.state;
                            skip = false;
                        }
                        //other wise we keep skiping untill next start state comes
                    }
                    
                    //if the final statechange is a resolution event we store the resolution time
                    //otherwise the resolution time is left open --> construct's lifespan has not ended
                    if(j === constructStates.length-1 && _states.resolution.indexOf(trimmedState) !== -1){
                        rt = c.time;
                    }
                    else if(_states.resolution.indexOf(trimmedState) !== -1){
                        //if there were resolution event in between we don't want to draw line from it
                        //to the start state but end the line. thus we need to skip next push
                        skip = true;
                    }
                }
                //adding the final state change if it is not yet added
                //if we are in skip mode we are still waitin for start state --> construct is in its resolution state
                //otherwise we haven't yet pushed the final state change
                if(!skip){
                    lifespans.push({
                        rowId : rid,
                        start : st,
                        state : state,
                        end : rt
                    });
                }
            }
        }
        return lifespans;
    };
    
    //Parses the link to related constructs into events and forms the id list ordered sorted by the event time stamp so that
    //the topmost drawn row in the visualization is the row where the first event happened and so on. This is the default ordering of rows for the visualization.
    //Construct map is a helper data structure which contains all constructs in a object where the key is the construct _id (MongoDB). The helper has been formed in
    //parseConstructs function --> parseConstructs NEEDS TO BE CALLED BEFORE THIS FUNCTION (PRECONDITION)!
    var parseEvents = function(events, constructMap){
        var evs = [];
        var types = [];
        var statechanges = [];
        
        //helper datastructure for parsing lifespans
        var states = {};
        
        var start = false;
        var end = false;
        
        var identity_helper = [];
        
        events.forEach(function(ev){
            //Ignoring duplicates
            if(identity_helper.indexOf(ev._id) === -1){
                identity_helper.push(ev._id);
                
                var time = new Date(ev.time).getTime();
                
                //detecting the timeframe
                if(time < start || start === false){
                    start = time;
                }
                if(time > end || end === false){
                    end = time;
                }
                
                if(ev.state !== "" && ev.state !== null &&
                ev.state !== undefined && ev.state !== false){
                    if(statechanges.indexOf(ev.state) === -1){
                        statechanges.push(ev.state);
                    }
                }
                if(types.indexOf(ev.type) === -1){
                    types.push(ev.type);
                }
                
                for(var i = 0; i < ev.related_constructs.length; ++i){
                    if(ev.related_constructs[i] === null || ev.related_constructs[i] === undefined){
                        continue;
                    }
                    var tmp  = {};
                    //Cloning the event object as it can have multiple constructs it is related to.
                    //as we want to visualize all events related to a construct in a single line
                    //we need to clone the event for all the constructs it relates to.
                    for(var property in ev){
                        if(ev.hasOwnProperty(property)){
                            tmp[property] = ev[property];
                        }
                    }
                    //Storing the link between events and constructs so that the visualization understands it.
                    if(constructMap[ev.related_constructs[i].toString()] !== undefined){
                        tmp.rowId = constructMap[ev.related_constructs[i].toString()].rowId;
                    
                        if(!states[tmp.rowId]){
                            states[tmp.rowId] = [];
                        }

                        //storing states for calculating lifespans
                        if(tmp.state !== "" && tmp.state !== null &&
                        tmp.state !== undefined && tmp.state !== false){
                            
                            var trimmedState = tmp.state.replace(/\s/g,'');
                            
                            if(_states.start.indexOf(trimmedState) !== -1 || 
                            _states.intermediate.indexOf(trimmedState) !== -1 ||
                            _states.resolution.indexOf(trimmedState) !== -1){
                                
                                states[tmp.rowId].push(tmp);
                            }
                        }
                        evs.push(tmp); 
                    }
                }
            }
            
        });
        
        //getting the lifespans from state data
        var lifespans = parseLifespans(states);
        
        //to get the ids sorted by the event time, we need to go through the sorted event array!
        //this needs to be done in order thus for loop instead of forEach function is used.
        //For each does not preserve order!
        evs.sort(eventSortFunction);
        /*var ids = [];
        for(var k = 0; k < evs.length; ++k){
            var id = evs[k].rowId;
            if(ids.indexOf(id) === -1){
                ids.push(id);
            }
        }*/
        statechanges.sort();
        types.sort();
        return {events:evs, lifespans : lifespans, timeframe:[new Date(start), new Date(end)], statechanges : statechanges, types: types};
    };
    
    //Parses construct data and state option data from constructs.
    //Adds rowId attribute to the constructs as it is needed for the visualization.
    //Forms helper data structure for event parsing.
    var parseConstructs = function(constructs){
        var ids_help = [];
        var anonymized = [];
        var processedConstructs = [];
        
        var identity_helper = [];
        
        var counter = 1;
        //The helper data structure is for linking construct origin_id.source_id to events
        var constructHelpper = {};
        constructs.forEach(function(construct){
            //To ignore duplicates
            if(identity_helper.indexOf(construct._id) === -1){
                identity_helper.push(construct._id);
                //Finding the right attribute of a construct for y axis indetifier
                var id = construct;
                if(_fromOrigin){
                    id = construct.origin_id[0];
                }
                for(var m = 0; m < _rowId.length; ++m){
                    id = id[_rowId[m].toString()];
                }
                
                //Anonymizing the row ids using the _astring base and a order number
                //Better method where anonymization function/map could be given as a parameter
                //for anonymization should be done next.
                var aid = _astring;
                //If the id is not in the list we add it and the anonymized correspondent
                //the anonymization is done even if it is not used at the moment. However,
                //as it is done in the same loop, it's not at the moment performance issue and
                //can be here as long as we come up with better method.
                if(ids_help.indexOf(id) === -1){
                    ids_help.push(id);
                    aid += counter.toString();
                    anonymized.push(aid);
                    ++counter;
                }
                else{
                    aid = anonymized[ids_help.indexOf(id)];
                }
                
                //row id is a visualization specific thing that is used in duration timeline chart
                //as Y-axis identified and everything that should be associated to a same line
                //should have same row id. If we use the anonymized ids we address the anonymized id to
                //the construct. Otherwise we use the non anonymized identifier.
                if(_anonymize){
                    construct.rowId = aid;
                }
                else{
                    construct.rowId = id;
                }
                constructHelpper[construct._id.toString()] = construct;
                processedConstructs.push(construct);
            }
            
            
            
        });
        return{helper:constructHelpper, processedConstructs : processedConstructs};
    };
    
    var removeUnwantedConstructs = function(ids, processedConstructs){
        var filteredStates = [];
        var lenId = 0;
        var longestId = "";
        
        var lenType = 0;
        var longestType = "";
        processedConstructs.forEach(function(construct){
            if(construct.rowId !== undefined){
                var id = construct.rowId;
                if(ids.indexOf(id) !== -1){
                    filteredStates.push(construct);
                    if(id.length > lenId){
                        lenId = id.length;
                        longestId = id;
                    }
                    if(construct.type.length > lenType){
                        lenType = construct.type.length;
                        longestType = construct.type;
                    }
                }
            }
        });
        return {constructs: filteredStates, longestType : longestType, longestId: longestId};
    };
    
    
    var sortRows = function(lifespans){
        var idHelper = {};
        var lptmp = [];
        var ids = [];
        lifespans.forEach(function(lp){
            if(idHelper[lp.rowId] === undefined){
                idHelper[lp.rowId] = {
                    start: lp.start,
                    end : lp.end
                };
            }
            else{
                var endtmp = idHelper[lp.rowId].end;
                if(endtmp !== false && lp.end !== false){
                    var e1 = new Date(endtmp).getTime();
                    var e2 = new Date(lp.end).getTime();
                    if(e2 > e1){
                        idHelper[lp.rowId].end = lp.end;
                    }
                }
                else{
                    idHelper[lp.rowId].end = false;
                }
                
                var s1 = new Date(idHelper[lp.rowId].start).getTime();
                var s2 = new Date(lp.start).getTime();
                if(s2 < s1){
                    idHelper[lp.rowId].start = lp.start;
                }
            }
        });
        for(var obj in idHelper){
            if(idHelper.hasOwnProperty(obj)){
                lptmp.push({start : idHelper[obj].start, end : idHelper[obj].end, rowId : obj});
            }
        }
        lptmp.sort(function(lp1, lp2){
            var s1 = new Date(lp1.start).getTime();
            var s2 = new Date(lp2.start).getTime();
            
            if(lp1.end === false && lp2.end === false){
                return s1-s2;
            }
            else if(lp1.end === false){
                return 1;
            }
            else if(lp2.end === false){
                return -1;
            }
            else{
                var t1 = new Date(lp1.end);
                var t2 = new Date(lp2.end);
                
                t1 = new Date(t1.getFullYear(), t1.getMonth(), t1.getDate()).getTime();
                t2 = new Date(t2.getFullYear(), t2.getMonth(), t2.getDate()).getTime();
                
                var e = t1-t2;
                if(e === 0){
                    return s1-s2;
                }
                else{
                    return e;
                }
            }
        });
        for(var i = 0; i < lptmp.length; ++i){
            ids.push(lptmp[i].rowId);
        }
        return ids;
    };
    
    var parseData = function(constructs, events){
        //object for the processed data
        var data = {};
        
        //from constructs we parse ids and constructs that are used
        //it also adds property rowID to constructs in _constructs list!
        var constructData = parseConstructs(constructs);
        
        var eventData = parseEvents(events, constructData.helper);
        data.events = eventData.events;
        data.timeframe = [new Date(eventData.timeframe[0].getFullYear(), eventData.timeframe[0].getMonth(), eventData.timeframe[0].getDate()-1),
            new Date(eventData.timeframe[1].getFullYear(), eventData.timeframe[1].getMonth(), eventData.timeframe[1].getDate()+1)];
        data.lifespans = eventData.lifespans;
        data.statechanges = eventData.statechanges;
        data.types = eventData.types;
        data.ids = sortRows(eventData.lifespans);
        
        var stripped = removeUnwantedConstructs(data.ids, constructData.processedConstructs);
        data.constructs = stripped.constructs;
        data.longestType = stripped.longestType;
        data.longestId = stripped.longestId;
        
        //giving the data to who needs it
        return data;
    };
    
    return parseData;
};