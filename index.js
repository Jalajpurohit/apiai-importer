#!/usr/bin/env node

const _ = require('lodash')
const fs = require('fs')
const parse = require('csv-parse')
const path = require('path')
const program = require('commander')
// const request = require('request')
const thenify = require('thenify')
const through = require('through')
const util = require('util')

const readFilePromise = thenify(fs.readFile)
const writeFilePromise = thenify(fs.writeFile)
// const requestPromise = thenify(request)
const parsePromise = thenify(parse)

const date = new Date();

program
  .option('-d, --directory <dir>', 'Specify a directory that contains "Answers.csv", "Entities.csv", and "Intents.csv" (defaults to cwd)')
  .option('-o, --output-dir <file>', 'Specify an output dir for the JSON (defaults to cwd)')
  // .option('-s, --subject <string>', 'Specify a subject to be deleted (or * to delete all)')
  .parse(process.argv)

// if (!program.subject || !program.directory) {
//   console.log('-s and -d are not optional')
//   process.exit()
// }

if (!program.directory) {program.directory = ''}
if (!program.outputDirectory) {program.outputDirectory = ''}

const inputPaths = {
  intents: path.join(program.directory, 'Intents.csv'),
  answers: path.join(program.directory, 'Answers.csv'),
  entities: path.join(program.directory, 'Entities.csv')
}

const timestamp = Math.floor(new Date() / 1000)

const outputPaths = {
  entities: path.join(program.outputDirectory, `output-entities-${timestamp}.json`),
  understandings: path.join(program.outputDirectory, `output-understandings-${timestamp}.json`)
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

    const synonyms = _.filter(data.synonyms.split(';').map(str => str.trim()))

    return {
      synonyms: synonyms,
      name: data.name.trim().substr(1).toLowerCase()
    }
  },

  intents (data) {
    if (!data.topic || !data.statement || _.startsWith(data.info, 'SKIP')) return

    const topic = data.topic.trim().toLowerCase()
    const statement = data.statement.trim()
    const synonyms = (data.synonyms && data.synonyms.trim() !== '')
      ? _.filter(data.synonyms.split(';').map(str => str.trim()))
      : []
    const outputContexts = (data.outputContext && data.outputContext.trim() !== '')
        ? _.filter(data.outputContext.split(';').map(str => str.trim().toLowerCase()))
        : []
    const inputContexts = (data.inputContext && data.inputContext.trim() !== '')
        ? _.filter(data.inputContext.split(';').map(str => str.trim().toLowerCase()))
        : []

    return {
      questions: [data.statement].concat(synonyms),
      outputContexts,
      inputContexts,
      topic
    }
  },

  answers (data) {
    if (!data.topic || !data.answer) return

    return {
      topic: data.topic.trim().toLowerCase(),
      answer: data.answer.trim()
    }
  }
}

function writeEntities (data) {
  console.log('    Writing Entities File')
  return Promise.resolve().then(() => {
    return writeFilePromise(outputPaths.entities, JSON.stringify(data, null, 2))
  }).then(() => {
    console.log(`    Wrote Entities File to ${outputPaths.entities}`)
  })
}

function buildEntities(entities) {
  return _.map(entities, entity => ({
    created: date,
    updated: date,
    name: entity.name,
    synonymGroups: [{
      messagingService: "georgia",
      synonyms: entity.synonyms
    }]
  }));
}

function buildUnderstandings(intents, answers) {
  return _.chain(intents)
    .groupBy('topic')
    .map((intentGroup, topic) => {
      const thisAnswer = _.find(answers, {topic: topic})
      if (!thisAnswer) return 

      return {
        created: date,
        updated: date,
        topic: topic,
        keywords: [],
        questionGroups: _.map(intentGroup, intent => ({
          inputContexts: intent.inputContexts,
          fuzzyQuestions: intent.questions,
          exactQuestions: []
        })),
        answerGroups: [{
          messagingService: "georgia",
          answers: [thisAnswer.answer],
        }],
        outputContexts: []
      }
    })
    .filter()
    .value()
}

function writeUnderstandings (data) {
  console.log('    Writing Understandings File')
  return Promise.resolve().then(() => {
    return writeFilePromise(outputPaths.understandings, JSON.stringify(data, null, 2))
  }).then(() => {
    console.log(`    Wrote Understandings File to ${outputPaths.understandings}`)
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

function run () {
  console.log('**** Starting ****')

  // Order matters here, because we can only delete entities if there are no intents referencing them
  Promise.resolve().then(() => {
    const dataPromises = _.map(['intents', 'entities', 'answers'], (type) => {
      return readFilePromise(inputPaths[type], {encoding: 'UTF-8'}).then(csvData => {
        return parseFunctions[type](csvData)
      }).then(data => {
        return _.chain(data)
          .map(cleanFunctions[type])
          .filter()
          .value()
      })
    })

    return Promise.all(dataPromises).then(dataAry => {
      return {
        intents: dataAry[0],
        entities: dataAry[1],
        answers: dataAry[2]
      }
    }).then(data => {
      return Promise.all([
        writeEntities(buildEntities(data.entities)),
        writeUnderstandings(buildUnderstandings(data.intents, data.answers))
      ])
    })
  }).then(() => {
    console.log('**** Done ****')
  }).catch(err => {
    console.error(err)
  })
}

run()