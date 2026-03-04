// send messages through whatsapp
// +447452706169 needs to be added to your group chat first
// or you need to be added as a contact on +447452706169 (manually)

var whatsapp = function()
{
    var send = function(destination, message)
    {
      Logger.log(message);
      SpreadsheetApp.getActiveSpreadsheet().getRangeByName(`CLBotOutput`).getCell(1,1).setValue(message);
      return {};
        var options = {
          'method' : 'post',
          'contentType': 'application/json',
          'payload' : JSON.stringify({
              destination: destination,
              message: message
          })
        };

        // simultaneous messages are handled by tasker on the device
        Logger.log("sending");
        var response = UrlFetchApp.fetch("https://motor-mouth.glitch.me/", options);
        
        Logger.log(response.getContentText());
        return response;
    }
    
    var sendList = function(destination, start, list, end)
    {
      var message = start + "\n\n" + list.join("\n") + "\n\n" + end;
      return send(destination, message);
    }
    
    return{
        send: send,
        sendList: sendList
    }
    
}();