# apiai-importer
CLI Tool for importing intents from a CSV file into API.ai. It will also output the Answers as a JSON file that can be imported into Mongo.

## Installation

```sh
npm install -g apiai-importer
cd $(npm root -g)/apiai-importer
cp conf.json.example conf.json
"${EDITOR:-vi}" conf.json
#add the Subscription Key and Developer Access Token from api.ai
```

## Usage

First, download the Intents and Entities sheets from the Google Doc, using the script below.

```sh
apiai-import -d ~/Google Drive/fafsa*\
```

## Notes

The Google Doc is the Single Source of Truth. This tool will delete all intents and entities from API.ai and regenerate them. Do not make modifications to API.ai directly - instead, change the Google Doc and reimport.

Use the `-e` flag to specify the environment.

This is a public repo, please do not push the keys.

## CSV Download Script

Run this script in the Google Sheets Script Editor to download all sheets to your Google Drive

```js
function onOpen() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var csvMenuEntries = [{name: "export as csv files", functionName: "saveAsCSV"}];
  ss.addMenu("csv", csvMenuEntries);
};

function saveAsCSV() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  // create a folder from the name of the spreadsheet
  var folder = DriveApp.createFolder(ss.getName().toLowerCase().replace(/ /g,'_') + '_csv_' + new Date().getTime());
  for (var i = 0 ; i < sheets.length ; i++) {
    var sheet = sheets[i];
    // append ".csv" extension to the sheet name
    fileName = sheet.getName() + ".csv";
    // convert all available sheet data to csv format
    var csvFile = convertRangeToCsvFile_(fileName, sheet);
    // create a file in the Docs List with the given name and the csv data
    folder.createFile(fileName, csvFile);
  }
  Browser.msgBox('Files are waiting in a folder named ' + folder.getName());
}

function convertRangeToCsvFile_(csvFileName, sheet) {
  // get available data range in the spreadsheet
  var activeRange = sheet.getDataRange();
  try {
    var data = activeRange.getValues();
    var csvFile = undefined;

    // loop through the data in the range and build a string with the csv data
    if (data.length > 1) {
      var csv = "";
      for (var row = 0; row < data.length; row++) {
        for (var col = 0; col < data[row].length; col++) {
          data[row][col] = "\"" + data[row][col].replace(/"/g, '""') + "\"";
        }

        // join each row's columns
        // add a carriage return to end of each row, except for the last one
        if (row < data.length-1) {
          csv += data[row].join(",") + "\r\n";
        }
        else {
          csv += data[row];
        }
      }
      csvFile = csv;
    }
    return csvFile;
  }
  catch(err) {
    Logger.log(err);
    Browser.msgBox(err);
  }
}
```