const Jesse = require('./jesse');

const data = [
  {
    item: {
      fields: {
        title: 'A title',
        subtitle: 'A subtitle',
        slug: 'a-file-name'
      }
    },
    text: 'booboo'
  },
  {
    item: {
      fields: {
        title: 'A second title',
        subtitle: 'A second subtitle',
        slug: 'a-second-name'
      }
    },
    text: 'second banana'
  },
  {
    item: {
      fields: {
        title: 'A third title',
        subtitle: 'A third subtitle',
        slug: 'a-third-name'
      }
    },
    text: 'third banana bobo ooowdf'
  }
];

Jesse.config({
  root: 'test',
  output: {
    filename: 'article/[item.fields.slug].html'
  }
});

Jesse.funnel(() => data);
Jesse.watch();
