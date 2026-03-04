var scraper = function()
{
  var phantom_key = "ak-serwc-4ed0h-kyq5c-jaq3b-fymj4"; //"ak-emegq-t9x5r-d7wc5-negk9-demt9";
  var att_base =  "http://www.attheraces.com/racecard/";
  var bref_base = "https://betref.co.uk/bet-finder";
  var phantom_base = "https://phantomjscloud.com/api/browser/v2/" + phantom_key + "/";
  
  var options = {
    muteHttpExceptions: true
  }
  
  var getRunners = function(raceDetails)
  {
    var raceDate = raceDetails.date;
    var raceLocation = raceDetails.location;
    var raceTime = raceDetails.time;
    
    var url = att_base + [raceLocation, raceDate, raceTime].join("/");
    
    var script = "return Array.prototype.slice.call(document.querySelectorAll('div.card-body div.card-cell--horse')).map(function(i){ return {name: i.querySelector('a.horse__link').innerText.split('(')[0].trim()};})";
    

    // for some reason they moved horsename to the jockey element
    var rankedScript = "return Array.prototype.slice.call(document.querySelectorAll('span.odds-grid-horse__jockey')).map(function(i){ return {name: i.innerText.split('(')[0].trim()};})";
    return getATTPhantom(url, rankedScript);
  }

  var getResult = function(raceDetails)
  {
    var raceDate = raceDetails.date;
    var raceLocation = raceDetails.location;
    var raceTime = raceDetails.time;
    
    var url = att_base + [raceLocation, raceDate, raceTime].join("/");
    
    var script = "return Array.prototype.slice.call(document.querySelectorAll('div#tab-full-result div.card-body div.card-section')).map(function(i){ return {position: i.childNodes[1].innerText, name: i.childNodes[7] ? i.childNodes[7].querySelector('a.horse__link').innerText.split('(')[0].trim() : ''};})";
    return getATTPhantom(url, script);
  }
  
  var getATTPhantom = function(url, script)
  {
    var payload = {
      url: url,
      renderType: "script",
      outputAsJson:false,
      scripts: {
        loadFinished: [ script ]
      }
    }

    /*
    
    div#tab-full-result div.card-body div.card-section
    
    
    */

    var params = {
      muteHttpExceptions: true,
      method: 'post',
      payload: JSON.stringify(payload),
      contentType: "application/json"
    };
    
    var response = UrlFetchApp.fetch(phantom_base, params); 
    Logger.log(response.getResponseCode())
    Logger.log(response.getContentText())
    var results = JSON.parse(response.getContentText());
    
   return results;    
 }
  
  var parseATTPage = function(html)
  {
    var tableMarker = 'id="racecard-table-racecard-results">';  
    var table = html.split(tableMarker)[1].split("<tbody>")[1].split("</tbody>")[0];
    
    var rows = table.split("<tr");

    var results = [];
    
    for(var i = 0; i < rows.length; i++)
    {
      var row = rows[i];
      
      if(row.replace(/\s/g, "").length == 0)
      {
        continue;
      }
      
      var cells = row.split("<tr");

      
      var values = cells.map(function(cell)
                             {
                              
                               return cell.replace(/.+>/, "").replace(/(<([^>]+)>)/g, "|").split("|").map(function(i){ return i.replace(/\s(?!\w)/g, "")}).filter(function(i){ return i.length; });
                             })[0];
      
      if(i == 1)
      {        
        values.splice(1, 0, "0");
      }
      Logger.log(values[11]);    
      results.push(values);     
    }
       
    return results;
  }
  
  var getBetRefPhantom = function(flags)
  {
    var payload = {
      url: bref_base,
      renderType: "script",
      outputAsJson:false,
      urlSettings:{
        operation: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        data: flags + "&submit="
      },
      scripts: {
        loadFinished: [ "return Array.prototype.slice.call(document.querySelectorAll('table tr:nth-child(n+2):not(:last-child)')).map(function(i){return {name: i.childNodes[1].innerText, race: i.childNodes[3].innerText, odds: i.childNodes[5].innerText};})"]
      }
    }

    var params = {
      muteHttpExceptions: true,
      method: 'post',
      payload: JSON.stringify(payload),
      contentType: "application/json"
    };
    
    var response = UrlFetchApp.fetch(phantom_base, params);    
    var page = response.getContentText();
    
   return page;
    
 }
  
 var getExtraInfo = function(location, date, time, tip)
 {
   var url = att_base + [location, date, time].join("/");
   var infoCode = "return Array.prototype.slice.call(document.querySelectorAll('div.card-body > div')).map(function(i){return {name: i.querySelector('a.name').innerText.split('(')[0].trim(), age: i.querySelector('span.age').innerText, weight: i.querySelector('span.weight').innerText}})";
   
   Logger.log(tip);
   var results = getPhantom(url, infoCode);
   Logger.log(results);
   
   if(results)
   {   
     for(var i = 0; i < results.length; i++)
     {
       var resultRow = results[i];
       if(!resultRow.name)
       {
         continue;
       }
       var horseName = resultRow.name.toLowerCase();

       if(horseName == tip[3].toLowerCase())
       {
         tip.push(resultRow.age);
         tip.push(convertWeight(resultRow.weight));
         return tip;
       }
     }
   }
   
   tip.push("");
   tip.push("");
   return tip;
 }
 
 var convertWeight = function(weight) 
 {
   var parts = weight.split("-");
   var st = parseInt(parts[0]);
   var lbs = parseInt(parts[1]);
   
   lbs += st * 14;
   
   return Math.round(lbs/2.2046);
 }

 var getPhantom = function(url, code)
  {
    var payload = {
      url: url,
      renderType: "script",
      outputAsJson:false,
      scripts: {
        loadFinished: [ code ]
      }
    }

    var params = {
      muteHttpExceptions: true,
      method: 'post',
      payload: JSON.stringify(payload),
      contentType: "application/json"
    };
    
    var response = UrlFetchApp.fetch(phantom_base, params);    
    var results = JSON.parse(response.getContentText());
    
   return results;    
 }
  //"http://www.attheraces.com/racecard/Pontefract/21-September-2017/1420"
  
  return{
    getRunners: getRunners,
    getResult: getResult,
    getBetRefPhantom: getBetRefPhantom,
    getExtraInfo: getExtraInfo,
    convertWeight: convertWeight
  }
  
}();

function testing()
{
  //scraper.getBetRefPhantom("s_odds=on");
  //return;
  //https://www.attheraces.com/racecard/Cheltenham/16-March-2021/1320
  var result = scraper.getRunners({date:"16-March-2021", location: "Cheltenham", time: 1320});
  Logger.log(result)
}