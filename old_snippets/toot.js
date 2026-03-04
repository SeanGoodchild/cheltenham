function dispatchToot() {
  var ss = SpreadsheetApp.openById(sheetId);
  var tootInfo = ss.getRangeByName("TootInfo").getValues();
  var horseName = tootInfo[0][4];
  var time = tootInfo[0][2];
  var availableHorses = ss.getRangeByName("HorseSelection").getDataValidation().getCriteriaValues()[0].getValues()[0];

if(availableHorses.indexOf(horseName) == -1)
  {
    ss.toast(horseName + " isn't running in the " + time + " you melt!", "TOOT FAILED");
    return;
  }
  
  var dataSheet = ss.getSheetByName("Data Sheet");

  var allRows = dataSheet.getRange(2, 1, dataSheet.getMaxRows()).getValues();
  var freeRow = 2;

  for (var i=0; i < allRows.length; i++)
  {
    if(allRows[i][0].length > 0)
    {
      continue;
    }
    else
    {
      freeRow = i+2;
      break;
    }
  }
  
  dataSheet.getRange(freeRow, 1, 1, tootInfo[0].length).setValues(tootInfo)
  //ss.getSheetByName("Data Sheet").appendRow(tootInfo[0]);
  ss.toast("Go on lad", "TOOT RECEIVED", 4)
}
