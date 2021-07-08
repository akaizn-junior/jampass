const jesse = require('./src/jesse');

const testData = [{
  item: {
    fields: {
      title: 'Laura Ipsumwich',
      subtitle: 'Writing about Laura',
      slug: 'laura',
      text: 'a lot of text, like a lot!'
    }
  }
}, {
  item: {
    fields: {
      title: 'Bastos ypsum',
      subtitle: 'A story about Bastos!',
      slug: 'bastos-ypsum',
      text: 'a lot of text, like a lot!'
    }
  }
}, {
  item: {
    fields: {
      title: 'Marky Markel fwer',
      subtitle: 'An episode of Mr. Robot',
      slug: 'marky-markel',
      text: 'a lot of text, like a lot!'
    }
  }
}];

jesse.funnel(() => testData);

module.exports = {
  config: {
    cwd: 'test',
    output: {
      filename: {
        'article': '-%item.fields.slug'
      }
    }
  }
};
