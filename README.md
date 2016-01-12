# apiai-importer
CLI Tool for importing intents from a CSV file into API.ai

## Installation

```sh
npm install -g apiai-importer
cd $(npm root -g)/apiai-importer
cp conf.json.example conf.json
"${EDITOR:-vi}" conf.json
#add the Subscription Key and Developer Access Token from api.ai
```

## Usage

First, download the Intents and Entities sheets from the Google Doc.

```sh
apiai-import -i ~/Downloads/FAFSA\ -\ Intents.csv -e ~/Downloads/FAFSA\ -\ Entities.csv
```

## Notes

The Google Doc is the Single Source of Truth. This tool will delete all intents and entities from API.ai and regenerate them. Do not make modifications to API.ai directly - instead, change the Google Doc and reimport.

This is a public repo, please do not push the keys.