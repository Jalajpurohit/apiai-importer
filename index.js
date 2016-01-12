const _ = require('lodash');
const pkg = require('./package')
const async = require('async');
const conf = require('./conf');
const fs = require('fs');
const parse = require('csv-parse');
const program = require('commander')
const request = require('request');
const through = require('through');
const util = require('util')

program
  .version(pkg.version)
  .option('-i, --intents <file>', 'Specify an intents CSV file')
  .option('-e, --entities <file>', 'Specify an entities CSV file')
  .parse(process.argv)



function cleanEntities (data) {
  if (!data.name || !data.synonyms) return;

  const synonyms = data.synonyms.split(';')

  return {
    word: synonyms[0],
    synonyms: synonyms,
    name: data.name.substr(1)
  }
}

function cleanIntents (data) {
  if (!data.topic || !data.answer || !data.statement) return;
  const synonyms = data.synonyms ? data.synonyms.split(';') : []

  return {
    inputs: [data.statement].concat(synonyms),
    outputContexts: data.outputContext ? [data.outputContext] : [],
    inputContexts: data.inputContext ? [data.inputContext] : [],
    topic: data.topic,
    answer: data.answer
  }
}

function pushIntents (data, done) {
  const body = {
    name: data.topic,
    auto: true,
    templates: data.inputs,
    contexts: data.inputContexts,
    responses: [{
      resetContexts: !data.outputContexts.length,
      affectedContexts: data.outputContexts,
      parameters: [],
      speech: [data.answer]
    }]
  }

  console.log(`    Importing Intent ${data.topic}`)

  apiCall('intents', {method: 'POST', body}, (err, res) => {
    if (err) {
      done(err)
    } else {
      console.log(`    Imported Intent ${data.topic} as ${res.id}`)
      done(null)
    }
  })
}

function pushEntities (data, done) {
  const body = {
    name: data.name,
    entries: [{
      value: data.word,
      synonyms: data.synonyms
    }]
  }

  console.log(`    Importing Entity ${data.name}`)

  apiCall('entities', {method: 'POST', body}, (err, res) => {
    if (err) {
      done(err)
    } else {
      console.log(`    Imported Entity ${data.name} as ${res.id}`)
      done(null)
    }
  })
}

function apiCall(endpoint, options, done) {
  request({
    url: `https://api.api.ai/v1/${endpoint}`,
    method: options.method || 'GET',
    qs: {v: '20150910'},
    body: options.body,
    json: true,
    auth: {bearer: conf.apiai.access_token},
    headers: {'ocp-apim-subscription-key': conf.apiai.subscription_key}
  }, (err, response, body) => {
    if (err) {
      done(err)
    } else {
      done(null, body)
    }
  })
}

function deleteAll(endpoint, done) {
  console.log(`** Deleting All ${endpoint} **`)
  apiCall(endpoint, {}, (err, res) => {
    if (err) {
      console.error(err)
    } else {
      async.each(res, (item, done) => {
        console.log(`    Deleting ${endpoint} ${item.name}`)
        apiCall(`${endpoint}/${item.id}`, {method: 'DELETE'}, (err) => {
          if (err) {
            done(err)
          } else {
            console.log(`    Deleted ${endpoint} ${item.name}`)
            done(null)
          }
        })
      }, done)
    }
  })
}

function parseIntents (data, done) {
  parse(data, {
    columns() {return ['url', 'statement', 'synonyms', 'topic', 'data', 'answer', 'outputContext', 'inputContext', 'link', 'additionalInfo'];}
  }, done)
}

function parseEntities (data, done) {
  parse(data, {
    columns() {return ['name', 'synonyms'];}
  }, done)
}

function importIntents (done) {
  console.log('** Importing Intents **')

  async.waterfall([
    (done) => fs.readFile(program.intents, {encoding: 'UTF-8'}, done),
    parseIntents,
    (data, done) => done(null, _.chain(data).map(cleanIntents).filter().value()),
    (data, done) => async.forEach(data, pushIntents, done)
  ], (err) => {
    done(err)
    if (!err) console.log('** Finished Importing Intents **');
  })
}

function importEntities (done) {
  console.log('** Importing Entities **')

  async.waterfall([
    (done) => fs.readFile(program.entities, {encoding: 'UTF-8'}, done),
    parseEntities,
    (data, done) => done(null, _.chain(data).map(cleanEntities).filter().value()),
    (data, done) => async.forEach(data, pushEntities, done)
  ], (err) => {
    done(err)
    if (!err) console.log('** Finished Importing Entities **');
  })
}


function doDeletions (done) {
  const toDelete = []
  if (program.intents) toDelete.push('intents')
  if (program.entities) toDelete.push('entities')

  async.eachSeries(toDelete, (endpoint, done) => {
    deleteAll(endpoint, done)
  }, done)
}

function doInsertions (done) {
  const toInsert = []
  if (program.entities) toInsert.push(importEntities)
  if (program.intents) toInsert.push(importIntents)

  async.series(toInsert, done)
}


async.waterfall([doDeletions, doInsertions], (err) => {
  if (err) {
    console.error(err)
  } else {
    console.log('**** Done ****')
  }
})

  // if (err) {
  //   console.error(err)
  // } else {
  //   if (program.intents) {
  //     importIntents(program.intents)
  //   }
  //   if (program.entities) {
  //     importEntities(program.entities)
  //   }
  // }
