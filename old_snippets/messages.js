
var groupName = "CA$H LAD$";
//var groupName = "Lewis Wilkie";
function sendSummary() {
  
  var now = new Date();
  var date = now.getDate();
  var day = [12,13,14,15].indexOf(date) + 1;

  var stakeAmount = getStaked(); // get this from sheet
  var stakeDescription = getDescription(stakeAmount);
  
  var racesRan = getRacesRan(day); // get this from sheet
  var totalRaces = 28;
  
  var pacingAmount = getPacingAmount(racesRan, stakeAmount); // get this from sheet
  var pacingDescription = getDescription(pacingAmount);
  
  var prevStake = 2369; //1798;
  
  var message = "*Cheltenham Day " + day + ":*\n"
  + "The lads have staked a " + stakeDescription + " *£" + stakeAmount + "* so far. "
  + "With " + racesRan + "/" + totalRaces + " races ran, 🆑s are pacing for a " + pacingDescription + " *£" + pacingAmount + "* total stake. "

  whatsapp.send(groupName, message);
}

function sendWinners(raceName, winningHorse)
{
  var ss = SpreadsheetApp.openById(sheetId);
  var dataSheet = ss.getSheetByName("Data Sheet");

  var allRows = dataSheet.getRange(2, 1, dataSheet.getMaxRows(), 6).getValues();
  
  var winners = allRows.filter(function(row){
    Logger.log(row);
    return row[4].length ? row[4].toLowerCase() == winningHorse.toLowerCase() : false;
  }).map(function(winningRows){
    return "🤑 " + winningRows[0] + " staked: £" + winningRows[5];
  }).sort(function(rowA, rowB){ return parseFloat(rowA[5], 10) - parseFloat(rowB[5], 10)});
  
  if(winners.length == 0)
  {
    whatsapp.send(groupName, "Results are in for the *" + raceName + "*\nThe winning horse was *"+ winningHorse +"*\n\nNot a great time to be a Cash Lad 😔");
  }
  else
  {         
    whatsapp.send(groupName, "Results are in for the *" + raceName + "*\nThe winning horse was *"+ winningHorse +"*\n\n" + winners.join("\n") + "\nWell done lad" + (winners.length > 1 ? "s" :"") +"!");
  }
}

function pub()
{
  whatsapp.send(groupName, "Which pub?");
}

function sendReminder()
{
  var now = new Date();
  // -13 for spain timezone, -12 for uk
  var hour = now.getHours() - 12; //Math.max(now.getHours() - 13, 0);
  var min = now.getMinutes();
  var nowTime = (hour * 100) + min;
  var raceTimes = [130, 210, 250, 330, 410, 450, 530];
  
Logger.log(hour)

  var nextRace = "";
  
  for(var i = 0; i < raceTimes.length; i++)
  {
    var raceTime = raceTimes[i];
    
    var hours = Math.floor(raceTime/100);
    var mins = raceTime%100;
    
    var timeToGo = (hours - hour) * 60 + (mins - min);

  Logger.log(timeToGo)
    if(timeToGo <= 16 && timeToGo > 1)
    {   
      nextRace = hours + ":" + mins;
      break;
    }
    else if(timeToGo > 16)
    {
      break;
    }   
  }

  if(nextRace)
  {
    var message = "We go again, next race starts at *" + nextRace + "* " + getOutburst() + ".\n\n";
    var leader = getLeader();
    var leaderNames = leader.names.length > 1 ? leader.names.slice(0, leader.names.length -1).join(", ").trim(", ") + " &" + leader.names[leader.names.length -1] : leader.names[0];
    var leaderString = "*" + leaderNames + (leader.names.length == 1 ? "* is " : "* are ") + "leading the pack with a " + getDescription(leader.amount, 8) + " *£" + leader.amount + "* profit.";
    message+= leaderString
    Logger.log(message);
    whatsapp.send(groupName, message);
  }
}

function getLeader()
{
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName("Main Cashboard");
  var profits = ss.getRangeByName("Profits");
  
  var best = profits.getValues().sort(function(a, b){
    var aNum = parseFloat(a[0], 10);
    var bNum = parseFloat(b[0], 10);
    
    aNum = isNaN(aNum) ? 0 : aNum;
    bNum = isNaN(bNum) ? 0 : bNum;
    
    return bNum - aNum;
  })[0];
  
  var leaders = [];
  
  profits.getValues().map(function(row, index){
    if(parseFloat(row[0], 10) == best)
    {
      leaders.push(index);
    }
  });

  var names = ss.getRangeByName("ProfitNames").getValues();
  return {amount: best, names: leaders.filter(function(index){ 

    if(names[index][0].length)
    {
      return true;
    }
    }).map(function(index){
    return names[index][0]; 
  })};
}

function getOutburst()
{
  var genericCLShit = [
    "ppfffffffttttttt",
    "SAMBA",
    "SHOCK",
    "HAARRRUUM",
    "sheeiii",
  ]

  var choice = Math.floor(Math.random() * genericCLShit.length);

  return genericCLShit[choice];
}

function getDescription(amount, modifier)
{
  modifier = modifier || 100;
  
  var descriptions = [
    "gordo-esque",
    "pathetic",
    "piss poor",
    "measly",
    "lowly",
    "disappointing",
    
    "forgettable",
    "below par",
    "underwhelming",
    "bang average",    
    "respectable",
    
    "tidy",
    "decent",
    "very healthy",
    "sensational",
    "unbelievable",
    
    "outrageous",
    "jaw-dropping",
    "astronomic",
    "truly historic",
  ]

  return descriptions[Math.min(Math.floor(amount/modifier), descriptions.length -1)];
}

function getStaked()
{
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Data Sheet");
  var numRows = sheet.getMaxRows();
  
  return sheet.getRange(2, 6, numRows).getValues().reduce(function(agg, row){ 
  
    var amount = parseFloat(row[0], 10);
    if(!isNaN(amount))
    {
      agg+= amount;
    }
    
    return agg  
  }, 0);
}

function getRacesRan(day)
{
  var now = new Date();
  var hour = Math.max(now.getHours() - 12, 0);
  var min = now.getMinutes();
  var nowTime = (hour * 100) + min;
  
  var raceTimes = [130, 210, 250, 330, 410, 450, 530];
  
  var racesDone = Math.max((day - 1) * 7, 0);
  var racesToday = 0;
  
  for(var i = 0; i < raceTimes.length; i++)
  {
    if(raceTimes[i] < nowTime + 5)
    {
      racesToday++;
    }
  }
  
  return racesDone + racesToday;
}

function getPacingAmount(racesRan, stake)
{ 
  var perRace = stake / racesRan;
  Logger.log(perRace);
  Logger.log(28 - racesRan);
  Logger.log(stake);
  
  return parseFloat(stake, 10) + (perRace * (28 - racesRan));
}