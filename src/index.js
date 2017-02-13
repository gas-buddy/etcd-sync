import fs from 'fs';
import url from 'url';
import path from 'path';
import Etcd from 'node-etcd';

export const Operations = {
  MakeDirectory: 'MKDIR',
  RemoveDirectory: 'RMDIR',
  DeleteValue: 'DEL',
  SetValue: 'SET',
};

function readAllInternal(dir, tree) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const fullPath = path.join(dir, f);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      tree[f] = {};
      readAllInternal(fullPath, tree[f]);
    } else {
      tree[f] = fs.readFileSync(fullPath);
    }
  }
  return tree;
}

export function readAllFromPath(dir) {
  return readAllInternal(dir, {});
}

function placeValues(tree, nodes, baseKey) {
  for (const k of nodes || []) {
    const subpath = k.key.substring(baseKey.length);
    if (k.dir === true) {
      const subtree = tree[subpath.substring(1)] = {};
      placeValues(subtree, k.nodes, k.key);
    } else {
      tree[subpath.substring(1)] = Buffer.from(k.value);
    }
  }
}

export function readAllFromEtcd(etcdUrl) {
  const parsed = url.parse(etcdUrl);
  const etcd = new Etcd(`${parsed.hostname}:${parsed.port || 2379}`);
  const content = etcd.getSync(parsed.path, { recursive: true });

  if (content.err && content.err.errorCode === 100) {
    return null;
  } else if (content.err) {
    throw content.err;
  }
  const tree = {};
  placeValues(tree, content.body.node.nodes, content.body.node.key);
  return tree;
}

function diffInternal(base, target, diffs, path) {
  if (base) {
    for (const [k, v] of Object.entries(base)) {
      const fullPath = `${path}/${k}`;
      if (!target || !target[k]) {
        diffs.push({ op: Operations.DeleteValue, key: fullPath });
      } else if (Buffer.isBuffer(v) !== Buffer.isBuffer(target[k])) {
        throw new Exception(`Mismatch between type of ${fullPath}`);
      } else {
        if (Buffer.isBuffer(v)) {
          // compare
          if (Buffer.compare(v, target[k]) !== 0) {
            diffs.push({ op: Operations.SetValue, key: `${fullPath}`, value: v });
          }
        } else {
          // recurse
          diffInternal(v, target ? target[k] : null, diffs, fullPath);
        }
      }
    }
    if (!target) {
      diffs.push({ op: Operations.RemoveDirectory, key: path });
    }
  }
  // Now flip the comparison looking for adds
  if (target) {
    for (const [k, v] of Object.entries(target)) {
      const fullPath = `${path}/${k}`;
      if (!base || !base[k]) {
        if (Buffer.isBuffer(v)) {
          diffs.push({ op: Operations.SetValue, key: fullPath, value: v });
        } else {
          diffs.push({ op: Operations.MakeDirectory, key: fullPath });
          diffInternal(null, v, diffs, fullPath);
        }
      }
    }
  }
}

export function diff(base, target) {
  const diffs = [];
  diffInternal(base, target, diffs, '');
  return diffs;
}

export function diffDescription(diffs, basePath, maxValueLen = 80) {
  if (!diffs || !diffs.length) {
    return 'No differences detected';
  }
  const descs = [];
  for (const d of diffs) {
    switch (d.op) {
      case Operations.MakeDirectory:
        descs.push(`MKDIR ${basePath}${d.key}`);
        break;
      case Operations.RemoveDirectory:
        descs.push(`RMDIR ${basePath}${d.key}`);
        break;
      case Operations.SetValue:
        descs.push(`SET   ${basePath}${d.key}: ${d.value.toString('utf-8').substring(0, maxValueLen)}${d.value.length > maxValueLen ? '...' : ''}`);
        break;
      case Operations.DeleteValue:
        descs.push(`DEL   ${basePath}${d.key}`);
        break;
      default:
        throw new Error(`Unknown operation: ${d.op}`);
    }
  }
  return descs.join('\n');
}

export function applyToEtcd(etcdUrl, diffs) {
  const parsed = url.parse(etcdUrl);
  const etcd = new Etcd(`${parsed.hostname}:${parsed.port || 2379}`);
  let pathPrefix = parsed.path || '';
  if (pathPrefix.endsWith('/')) {
    pathPrefix = pathPrefix.substring(0, pathPrefix.length - 2);
  }
  for (const d of diffs) {
    const key = `${pathPrefix}${d.key}`;
    switch (d.op) {
      case Operations.MakeDirectory:
        etcd.mkdirSync(key);
        break;
      case Operations.RemoveDirectory:
        etcd.rmdirSync(key);
        break;
      case Operations.SetValue:
        etcd.setSync(key, d.value);
        break;
      default:
        throw new Error(`Unknown operation: ${d.op}`);
    }
  }
}

export function applyToFilesystem(basePath, diffs) {
  for (const d of diffs) {
    const key = path.join(basePath, d.key);
    switch (d.op) {
      case Operations.MakeDirectory:
        fs.mkdirSync(key);
        break;
      case Operations.RemoveDirectory:
        fs.rmdirSync(key);
        break;
      case Operations.SetValue:
        fs.writeFileSync(key, d.value);
        break;
      default:
        throw new Error(`Unknown operation: ${d.op}`);
    }
  }
}