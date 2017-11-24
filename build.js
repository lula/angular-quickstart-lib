'use strict';

const fs = require('fs');
const path = require('path');
const glob = require('glob');
const camelCase = require('camelcase');
const ngc = require('@angular/compiler-cli/src/main').main;
const rollup = require('rollup');
const uglify = require('rollup-plugin-uglify');
const sourcemaps = require('rollup-plugin-sourcemaps');
const nodeResolve = require('rollup-plugin-node-resolve');
const commonjs = require('rollup-plugin-commonjs');

const inlineResources = require('./inline-resources');

const libName = require('./package.json').name;
const rootFolder = path.join(__dirname);
const compilationFolder = path.join(rootFolder, 'out-tsc');
const srcFolder = path.join(rootFolder, 'src/lib');
const distFolder = path.join(rootFolder, 'dist');
const tempLibFolder = path.join(compilationFolder, 'lib');
const es5OutputFolder = path.join(compilationFolder, 'lib-es5');
const es2015OutputFolder = path.join(compilationFolder, 'lib-es2015');

return Promise.resolve()
  // Copy library to temporary folder and inline html/css.
  .then(() => _relativeCopy(`**/*`, srcFolder, tempLibFolder)
    .then(() => inlineResources(tempLibFolder))
    .then(() => console.log('Inlining succeeded.'))
  )
  // Compile to ES2015.
  .then(() => {
    if (ngc(['-p', `${tempLibFolder}/tsconfig.lib.json`])) {
      return Promise.reject();
    }
    console.log('ES2015 compilation succeeded.')
    return Promise.resolve();
  })
  // Compile to ES5.
  .then(() => {
    if (ngc(['-p', `${tempLibFolder}/tsconfig.es5.json`])) {
      return Promise.reject()
    }
    console.log('ES5 compilation succeeded.');
    return Promise.resolve();
  })
  // Copy typings and metadata to `dist/` folder.
  .then(() => Promise.resolve()
    .then(() => _relativeCopy('**/*.d.ts', es2015OutputFolder, distFolder))
    .then(() => _relativeCopy('**/*.metadata.json', es2015OutputFolder, distFolder))
    .then(() => console.log('Typings and metadata copy succeeded.'))
  )
  // Bundle lib.
  .then(() => {
    // Base configuration.
    const es5Entry = path.join(es5OutputFolder, `${libName}.js`);
    const es2015Entry = path.join(es2015OutputFolder, `${libName}.js`);

    // ATTENTION:
    // Add any dependency or peer dependency your library to `globals` and `external`.
    // This is required for UMD bundle users.
    const rollupGlobals = {
      // The key here is library name, and the value is the the name of the global variable name
      // the window object.
      '@angular/core': 'ng.core'
    };

    const rollupBaseConfig = {
      inputOptions: {
        external: Object.keys(rollupGlobals),
        plugins: [
          commonjs({
            include: ['node_modules/rxjs/**']
          }),
          sourcemaps(),
          nodeResolve({
            jsnext: true,
            module: true
          })
        ]
      },
      outputOptions: {
        name: camelCase(libName),
        format: 'umd',
        sourcemap: true,
        globals: rollupGlobals
      }
    };

    // UMD bundle.
    const umdConfig = Object.assign({}, {
      inputOptions: Object.assign({}, rollupBaseConfig.inputOptions, { 
        input: es5Entry 
      }),
      outputOptions: Object.assign({}, rollupBaseConfig.outputOptions, {
        file: path.join(distFolder, `bundles`, `${libName}.umd.js`)
      })
    });

    // Minified UMD bundle.
    const minifiedUmdConfig = Object.assign({}, {
      inputOptions: Object.assign({}, rollupBaseConfig.inputOptions, { 
        input: es5Entry,
        plugins: rollupBaseConfig.inputOptions.plugins.concat([uglify({})])
      }),
      outputOptions: Object.assign({}, rollupBaseConfig.outputOptions, { 
        file: path.join(distFolder, `bundles`, `${libName}.umd.min.js`) 
      })
    });

    // ESM+ES5 flat module bundle.
    const fesm5config = Object.assign({}, {
      inputOptions: Object.assign({}, rollupBaseConfig.inputOptions, {
        input: es5Entry
      }),
      outputOptions: Object.assign({}, rollupBaseConfig.outputOptions, {
        file: path.join(distFolder, `${libName}.es5.js`),
      })
    });

    // ESM+ES2015 flat module bundle.
    const fesm2015config = Object.assign({}, {
      inputOptions: Object.assign({}, rollupBaseConfig.inputOptions, {
        input: es2015Entry
      }),
      outputOptions: Object.assign({}, rollupBaseConfig.outputOptions, {
        file: path.join(distFolder, `${libName}.js`)
      })
    });

    const allBundles = [
      umdConfig,
      minifiedUmdConfig,
      fesm5config,
      fesm2015config
    ].map(cfg => {
      rollup.rollup(cfg.inputOptions).then(bundle => bundle.write(cfg.outputOptions));
    });

    return Promise.all(allBundles)
      .then(() => console.log('All bundles generated successfully.'))
  })
  // Copy package files
  .then(() => Promise.resolve()
    .then(() => _relativeCopy('LICENSE', rootFolder, distFolder))
    .then(() => _relativeCopy('package.json', rootFolder, distFolder))
    .then(() => _relativeCopy('README.md', rootFolder, distFolder))
    .then(() => console.log('Package files copy succeeded.'))
  )
  .catch(e => {
    console.error('\Build failed. See below for errors.\n');
    console.error(e);
    process.exit(1);
  });


// Copy files maintaining relative paths.
function _relativeCopy(fileGlob, from, to) {
  return new Promise((resolve, reject) => {
    glob(fileGlob, {
      cwd: from,
      nodir: true
    }, (err, files) => {
      if (err) reject(err);
      files.forEach(file => {
        const origin = path.join(from, file);
        const dest = path.join(to, file);
        const data = fs.readFileSync(origin, 'utf-8');
        _recursiveMkDir(path.dirname(dest));
        fs.writeFileSync(dest, data);
        resolve();
      })
    })
  });
}

// Recursively create a dir.
function _recursiveMkDir(dir) {
  if (!fs.existsSync(dir)) {
    _recursiveMkDir(path.dirname(dir));
    fs.mkdirSync(dir);
  }
}

