// triggers needed
// checkDay - 15 mins
// sendReminder - 15 mins
// sendSummary - daily
// updateRunners - daily
const today = "15-March-2024";
const raceDay = 4;
const sheetId = "1BbzSsQuDJeqqXM5rsM0sXmcKD24Puur-KUMJzNQzKqg";

function checkDay()
{
  var debug = false;
  var raceTimes = SpreadsheetApp.getActiveSpreadsheet().getRangeByName(`raceTimesDay${raceDay}`).getDisplayValues();
  var raceResults = SpreadsheetApp.getActiveSpreadsheet().getRangeByName(`raceResultsDay${raceDay}`);
  
  Logger.log(raceResults.getA1Notation())

  for(var i = 0; i < raceTimes.length; i++) 
  {
    var time = raceTimes[i];
    var timeParts = time.toString().split(".");
    
    var now = new Date();
    var hour = parseInt(timeParts[0]) + 12;
    var min = parseInt(timeParts[1]);
    
    var haveResult = raceResults.getCell(i + 1, 1).getValue().length > 2;
    
    Logger.log(raceResults.getCell(i + 1, 1).getValue())

    if(!debug){    
      if(haveResult)
      {
        Logger.log("have result for " + timeParts[0] + "." + timeParts[1] + " - skipped");
        continue
      }
      else if(now.getHours() < hour)
      {
        Logger.log("not time to check " + timeParts[0] + "." + timeParts[1] + " yet - skipped");
        continue;
      }
      else if (now.getHours() == hour && now.getMinutes() < (min + 9))
      {
        Logger.log("not time to check " + timeParts[0] + "." + timeParts[1] + " yet - skipped");
        continue;
      }
    }
    
    var raceOptions = {
      location: "Cheltenham",
      date: today,
      time: hour.toString() + timeParts[1]
    }

    if(debug) {
      raceOptions = {
        location: "Kempton",
        date: "09-March-2020",
        time: "1430"
      }
    }
    
    var results = scraper.getResult(raceOptions);
    Logger.log(results);
    
    if(results && results.message)   
    {
      Logger.log(results.message);
      //return;
    }
    
    //var places = results ? results.sort(function(a,b) { return a.position - b.position; }) : null ;
    var places = results;
    
    if(places && places.length > 1)
    {    
      var formattedNames = places.map(function(j){ return j.name.toLowerCase().split(" ").map(function(i){ return i.substring(0,1).toUpperCase() + i.substring(1) }).join(" "); });      
      raceResults.getCell((i + 1), 1).setValue(formattedNames[0]);
      
      for(var l = 1; l < Math.min(formattedNames.length, 7); l++)
      {
        if(formattedNames[l] && formattedNames[l].length > 2)
        {
          raceResults.getCell((i + 1), 1).offset(0,l).setValue(formattedNames[l]);      
        }
        else
        {
          l--;
          formattedNames.splice(l, 1);
        }
      }
      
      sendWinners(hour.toString() +":"+ timeParts[1], formattedNames[0]);     
    }
    
    break;
  }
}

function updateRunners()
{
  var raceTimes = SpreadsheetApp.getActiveSpreadsheet().getRangeByName(`raceTimesDay${raceDay}`).getDisplayValues();
  var raceRunners = SpreadsheetApp.getActiveSpreadsheet().getRangeByName(`raceRunnersDay${raceDay}`);
  
  for(var i = 0; i < raceTimes.length; i++) 
  {
    var time = raceTimes[i];
    var timeParts = time.toString().split(".");
    
    var now = new Date();
    var hour = parseInt(timeParts[0]) + 12;
    var min = parseInt(timeParts[1]);
    
  var raceOptions = {
      location: "Cheltenham",
      date: today,
      time: hour.toString() + timeParts[1]
    }
    
    Logger.log(raceOptions)
    var runners = scraper.getRunners(raceOptions);
    Logger.log(runners);
    
    if(runners && runners.message)   
    {
      Logger.log(runners.message);
      return;
    }
    
    if(runners && runners.length > 1)
    {    
      Logger.log("clearing runners from cell:");
      Logger.log(raceRunners.getCell(1+i, 1).getA1Notation());
      raceRunners.getCell(1,1).offset(i,1,1,50).clearContent();

      var formattedNames = runners.map(function(j){ return j.name.toLowerCase().split(" ").map(function(i){ return i.substring(0,1).toUpperCase() + i.substring(1) }).join(" "); });      
      
      Logger.log("writing runners from cell:");
      Logger.log(raceRunners.getCell((i+1), 1).getA1Notation());

      for(var l = 0; l < formattedNames.length; l++)
      {
        if(formattedNames[l] && formattedNames[l].length > 2)
        {
          raceRunners.getCell((i+1), 1).offset(0,l + 1).setValue(formattedNames[l]);      
        }
        else
        {
          l--;
          formattedNames.splice(l, 1);
        }
      }
      
    }
  }
}

function test_stuff()
{
  sendWinners("1:30", "Note Bleu");  
}