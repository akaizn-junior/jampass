const faker = require('faker');
const path = require('path');
const jesse = require('../src/jesse');

jesse.funnel(() => {
  const fakeData = [];
  const fakeItemsCount = 100;
  const colors = ['blue', 'black', 'red', 'cyan', 'orange', 'purple'];

  faker.seed(fakeItemsCount);

  for (let i = 0; i < fakeItemsCount; i++) {
    const date = faker.date.recent(3);
    fakeData.push({
      name: faker.name.firstName(),
      description: faker.lorem.words(3),
      breed: faker.animal.cat(),
      insertedAt: `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
      photo: faker.image.dataUri(500, 500, colors[faker.datatype.number(colors.length)])
    });
  }

  const date = faker.date.recent(3);
  fakeData.push({
    name: faker.name.firstName(),
    description: 'Doggo surprise',
    breed: faker.animal.dog(),
    insertedAt: `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
    photo: colors[faker.datatype.number(colors.length)]
  });

  return fakeData;
});

function configEngine(handlebars) {
  handlebars.registerHelper('eq', (a, b) => a === b);
  handlebars.registerHelper('neq', (a, b) => a !== b);
}

module.exports = {
  cwd: path.join(__dirname, 'cats'),
  site: {
    name: 'Adopt Animals',
    author: 'Kat McMeowsface'
  },
  locales: [{
    lang: 'en-US',
    entry: '',
    json: 'locales/en_US.json'
  }, {
    lang: 'pt-AO',
    entry: '/pt-AO',
    json: 'locales/pt_AO.json'
  }],
  build: {
    mode: jesse.JESSE_BUILD_MODE_LAZY
  },
  views: {
    engine: {
      // handlebars by default, name ommitted
      config: configEngine
    }
  },
  assets: {
    trust: ['placeimg.com']
  },
  output: {
    filename: {
      'cat.html': '-[insertedAt]/[name]/',
      'pt-AO/cat.html': '-pt-AO/[insertedAt]/[name]/'
    }
  }
};
