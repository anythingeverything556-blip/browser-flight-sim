#!/usr/bin/env python3
"""Extract a single G1000 configuration and its original motion descriptions."""
import json
import math
import pathlib
import sys
import xml.etree.ElementTree as ET

root = pathlib.Path(sys.argv[1]).resolve()
output = pathlib.Path(sys.argv[2])
instances = []
rules = []
missing = []
skipped = []


def values(element):
    if element is None:
        return None
    if len(element) == 0:
        text = (element.text or '').strip()
        try:
            return float(text)
        except ValueError:
            return text
    result = {}
    for child in element:
        value = values(child)
        if child.tag in result:
            if not isinstance(result[child.tag], list):
                result[child.tag] = [result[child.tag]]
            result[child.tag].append(value)
        else:
            result[child.tag] = value
    return result


def resolve(parent, reference):
    reference = reference.strip()
    if reference.startswith('Aircraft/DA40/'):
        path = root / reference[len('Aircraft/DA40/'):]
    elif reference.startswith('Aircraft/'):
        path = root / reference
    else:
        path = (parent.parent / reference).resolve()
        if not path.is_file():
            path = root / reference
    return path if path.is_file() and path.resolve().is_relative_to(root) else None


def walk(path, parent_id, offsets=None, overlay=None, chain=()):
    relative = path.relative_to(root).as_posix()
    if relative in chain:
        raise ValueError(f'Circular model reference: {relative}')
    element = ET.parse(path).getroot()
    instance_id = f'da40-instance-{len(instances):03d}'
    instance = {'id': instance_id, 'xml': relative, 'parent': parent_id,
                'offsets': offsets or {}, 'overlay': overlay or {}, 'geometry': None,
                'textureOverrides': {}}
    instances.append(instance)
    geometry = element.findtext('path')
    if geometry:
        source = resolve(path, geometry)
        if source and source.suffix.lower() in ('.ac', '.gltf'):
            instance['geometry'] = source.relative_to(root).as_posix()
        elif source is None:
            missing.append({'xml': relative, 'reference': geometry.strip()})
    groups = {}
    for animation in element.findall('animation'):
        kind = (animation.findtext('type') or '').strip()
        name = (animation.findtext('name') or '').strip()
        targets = [(item.text or '').strip() for item in animation.findall('object-name')]
        if name and not kind:
            groups[name] = targets
        texture_path = animation.findtext('texture') if kind == 'material' else animation.findtext('base-color-texture') if kind == 'pbr' else None
        if texture_path:
            texture = resolve(path, texture_path)
            if texture:
                for target in targets:
                    instance['textureOverrides'][target] = texture.relative_to(root).as_posix()
        if kind not in ('rotate', 'spin', 'translate'):
            if kind:
                entry = {'instance': instance_id, 'type': kind, 'targets': targets}
                if kind == 'select':
                    entry['condition'] = values(animation.find('condition'))
                skipped.append(entry)
            continue
        expanded = []
        for target in targets:
            expanded.extend(groups.get(target, [target]))
        details = {child.tag: values(child) for child in animation
                   if child.tag not in ('object-name', 'type', 'name')}
        rules.append({'instance': instance_id, 'type': kind, 'targets': expanded,
                      'sourceTargets': targets, 'details': details})
    for model in element.findall('model'):
        reference = (model.findtext('path') or '').strip()
        if not reference:
            continue
        if reference == 'Panel/panel.xml' or '/ALS_lights/' in reference:
            skipped.append({'instance': instance_id, 'type': 'configuration', 'reference': reference})
            continue
        source = resolve(path, reference)
        if source is None:
            missing.append({'xml': relative, 'reference': reference})
        elif source.suffix.lower() == '.xml':
            walk(source, instance_id, values(model.find('offsets')), values(model.find('overlay')),
                 chain + (relative,))
        else:
            skipped.append({'instance': instance_id, 'type': 'non-xml-model', 'reference': reference})


walk(root / 'Models/da40ng.xml', None)
output.write_text(json.dumps({'instances': instances, 'rules': rules, 'missing': missing,
                              'skipped': skipped}, separators=(',', ':')))
print(f'{len(instances)} model instances, {len(rules)} motion rules, {len(missing)} missing references')
