import url from 'url';
import path from 'path';
import minimist from 'minimist';
import winston from 'winston';
import * as sync from './index';

const argv = minimist(process.argv.slice(2), { boolean: true });

function isUrl(v) {
  const p = url.parse(v);
  return p && p.protocol && p.host;
}

if (!argv._ || argv._.length < 2 || !isUrl(argv._[0]) ||
  (!argv['to-etcd'] === !argv['to-files'])) {
  console.error('Usage:');
  console.error('  etcd-sync <etcd-url> <local-path> [--to-etcd or --to-files] [--apply]');
  process.exit(-1);
}

const localContent = sync.readAllFromPath(path.resolve(argv._[1]));
const etcdContent = sync.readAllFromEtcd(argv._[0]);

const toSync = sync.diff(
  argv['to-etcd'] ? etcdContent : localContent,
  argv['to-etcd'] ? localContent : etcdContent
);

if (!argv.apply) {
  console.log('--apply not specified. Operations to perform:');
}

if (argv['to-etcd']) {
  if (!argv.apply) {
    const u = url.parse(argv._[0]);
    console.log(sync.diffDescription(toSync, u.path));
  } else {
    sync.applyToEtcd(argv._[0], toSync);
    winston.info('[etcd-sync] file system synchronized to etcd');
  }
} else {
  if (!argv.apply) {
    console.log(sync.diffDescription(toSync, argv._[1]));
  } else {
    sync.applyToFilesystem(argv._[1], toSync);
    winston.info('[etcd-sync] etcd synchronized to file system');
  }
}