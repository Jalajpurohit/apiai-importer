#!/usr/bin/env node

const _ = require('lodash')
const pkg = require('./package')
const conf = require('./conf')
const fs = require('fs')
const parse = require('csv-parse')
const path = require('path')
const program = require('commander')
const request = require('request')
const thenify = require('thenify')
const through = require('through')
const util = require('util')

const readFilePromise = thenify(fs.readFile)
const writeFilePromise = thenify(fs.writeFile)
const requestPromise = thenify(request)
const parsePromise = thenify(parse)

program
  .version(pkg.version)
  .option('-d, --directory <dir>', 'Specify a directory that contains "Answers.csv", "Entities.csv", and "Intents.csv"')
  .option('-e, --env <"test"|"dev">', 'specify an environment to import to (as declared in conf.json)')
  .option('-o, --answer-output <file>', 'Specify an output file for the Answers JSON (defaults to ./[epoch]-answers.json')
  .option('-s, --subject <string>', 'Specify a subject to be deleted (or * to delete all)')
  .parse(process.argv)

if (!program.subject || !program.directory) {
  console.log('-s and -d are not optional')
  process.exit()
}

program.intents = path.join(program.directory, 'Intents.csv')
program.answers = path.join(program.directory, 'Answers.csv')
program.entities = path.join(program.directory, 'Entities.csv')

if (!program.answerOutput) {
  program.answerOutput = `${Math.floor(new Date() / 1000)}-answers.json`
}

if (!program.env) {
  program.env = 'dev'
}

const parseFunctions = {
  intents (data) {
    return parsePromise(data, {
      columns () {
        return ['info', 'statement', 'synonyms', 'topic', 'outputContext', 'inputContext']
      }
    })
  },

  entities (data) {
    return parsePromise(data, {
      columns () {
        return ['name', 'synonyms']
      }
    })
  },

  answers (data) {
    return parsePromise(data, {
      columns () {
        return ['topic', 'answer']
      }
    })
  }
}

function subPaths (input) {
  const components = input.split('/')
  const outputs = []

  for (var i = 1; i < components.length; i++) {
    outputs.push(components.slice(0, i + 1).join('/'))
  }
  return outputs
}

const cleanFunctions = {
  entities (data) {
    if (!data.name || !data.synonyms) return

    const synonyms = data.synonyms.trim().split(';')

    return {
      word: synonyms[0],
      synonyms: synonyms,
      name: data.name.trim().substr(1)
    }
  },

  intents (data) {
    if (!data.topic || !data.statement || _.startsWith(data.info, 'SKIP')) return

    const topic = data.topic.trim()
    const statement = data.statement.trim()
    const synonyms = (data.synonyms && data.synonyms.trim() !== '')
      ? data.synonyms.trim().split(';')
      : []
    const outputContexts = (
      (data.outputContext && data.outputContext.trim() !== '')
        ? data.outputContext.trim().split(';')
        : []
    ).concat(subPaths(topic))
    const inputContexts = (
      (data.inputContext && data.inputContext.trim() !== '')
        ? data.inputContext.trim().split(';')
        : []
    ).concat(`/${topic.split('/')[1]}`)

    return {
      inputs: [data.statement].concat(synonyms),
      outputContexts,
      inputContexts,
      topic
    }
  },

  answers (data) {
    if (!data.topic || !data.answer) return

    return {
      topic: data.topic.trim(),
      answer: data.answer.trim()
    }
  }
}

const pushFunctions = {
 intents (data) {
    const pushPromises = _.map(data, item => {
      const body = {
        name: item.topic,
        auto: true,
        templates: item.inputs,
        contexts: item.inputContexts,
        responses: [{
          action: item.topic,
          resetContexts: !item.outputContexts.length,
          affectedContexts: item.outputContexts
        }]
      }

      console.log(`    Importing Intent ${item.topic}`)

      return apiCall('intents', {method: 'POST', body}).then((res) => {
        console.log(`    Imported Intent ${item.topic} as ${res.id}`)
      })
    })

    return Promise.all(pushPromises)
  },

  entities (data) {
    const pushPromises = _.map(data, item => {
      const body = {
        name: item.name,
        entries: [{
          value: item.word,
          synonyms: item.synonyms
        }]
      }

      console.log(`    Importing Entity ${item.name}`)

      return apiCall('entities', {method: 'POST', body}).then(res => {
        console.log(`    Imported Entity ${item.name} as ${res.id}`)
      })
    })

    return Promise.all(pushPromises)
  },

  answers (data) {
    console.log('    Writing Answers File')
    return Promise.resolve().then(() => {
      return writeFilePromise(program.answerOutput, JSON.stringify(data, null, 2))
    }).then(() => {
      console.log(`    Wrote Answers File to ${program.answerOutput}`)
    })
  }
}

function apiCall(endpoint, options) {
  if (!options) options = {}

  const env = program.env
  if (!conf.env || !conf.env[env] || !conf.env[env].apiai) {
    console.log('Invalid conf.json file or invalid env specified:', env)
    return Promise.reject()
  }

  return requestPromise({
    url: `https://api.api.ai/v1/${endpoint}`,
    method: options.method || 'GET',
    qs: {v: '20150910'},
    body: options.body,
    json: true,
    auth: {bearer: conf.env[env].apiai.access_token},
    headers: {'ocp-apim-subscription-key': conf.env[env].apiai.subscription_key}
  }).then(res => {
    return res[1]
  })
}

function filterName (type, name) {
  if (program.subject === '*') {
    return true
  }

  if (type === 'intents') {
    return _.startsWith(name, `/${program.subject}/`)
  } else {
    return _.startsWith(name, `${program.subject}-`)
  }
}

function deleteAll (type) {
  console.log(`** Deleting All ${_.capitalize(type)} **`)

  return apiCall(type).then(res => {
    const deletePromises = _.chain(res)
    .map(item => {
      if (filterName(type, item.name)) {
        console.log(`    Deleting ${type} ${item.name}`)

        return apiCall(`${type}/${item.id}`, {method: 'DELETE'}).then(res => {
          console.log(`    Deleted ${type} ${item.name}`)
        })
      }
    })
    .filter()
    .value()

    return Promise.all(deletePromises)
  }).then(() => {
    console.log(`** Deleted All ${_.capitalize(type)} **`)
  })
}

function importAll (type) {
  console.log(`** Importing ${_.capitalize(type)} **`)

  return readFilePromise(program[type], {encoding: 'UTF-8'}).then(csvData => {
    return parseFunctions[type](csvData)
  }).then(data => {
    return _.chain(data)
      .map(cleanFunctions[type])
      .filter()
      .value()
  }).then(pushFunctions[type])
  .then(() => {
     console.log(`** Finished Importing ${_.capitalize(type)} **`);
  })
}

function getTypes (del) {
  const types = []
  if (del) {
    if (program.intents) types.push('intents')
    if (program.entities) types.push('entities')
  } else {
    if (program.entities) types.push('entities')
    if (program.intents) types.push('intents')
    if (program.answers) types.push('answers')
  }

  return types
}

function applyInSeries(types, func) {
  return _.reduce(types, (promise, type) => {
    return promise.then(() => func(type))
  }, Promise.resolve())
}

function run () {
  const types = getTypes()

  console.log('**** Starting ****')

  // Order matters here, because we can only delete entities if there are no intents referencing them
  Promise.resolve().then(() => {
    return applyInSeries(getTypes(true), deleteAll)
  }).then(() => {
    console.log('** Done Deleting **')
  }).then(() => {
    return applyInSeries(getTypes(), importAll)
  }).then(() => {
    console.log('** Done Inserting **')
  }).then(() => {
    console.log('**** Done ****')
  }).catch(err => {
    console.error(err)
  })
}

run()