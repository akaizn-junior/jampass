const jesse = require('./src/jesse');

const testData = [{
  item: {
    fields: {
      title: 'Laura Ipsumwich',
      subtitle: 'Writing about Laura',
      slug: 'laura',
      text: 'a lot of text, like a lot!'
    },
    date: '2021-06-7'
  }
}, {
  item: {
    fields: {
      title: 'Bastos ypsum',
      subtitle: 'A story about Bastos!',
      slug: 'bastos-ypsum',
      text: 'a lot of text, like a lot!'
    },
    date: '2021-06-8'
  }
}, {
  item: {
    fields: {
      title: 'Marky Markel fwer',
      subtitle: 'An episode of Mr. Robot',
      slug: 'marky-markel',
      text: 'a lot of text, like a lot!'
    },
    date: '2021-06-8'
  }
}];

jesse.funnel(() => testData);

module.exports = {
  config: {
    cwd: 'test',
    output: {
      filename: {
        'article': '-blog/%item.date/%item.fields.slug/',
        'blog': 'blog/'
      }
    }
  }
};
