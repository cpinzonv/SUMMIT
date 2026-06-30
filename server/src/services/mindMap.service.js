/**
 * Mind maps — Claude-generated concept graphs (nodes + edges) stored as JSONB.
 * Nodes are colored by level (root=coral, level1=peach, level2=teal) so the
 * SVG viewer can lay them out hierarchically.
 */
import { query } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { getOwnedClass } from './class.service.js';
import { gatherClassContext } from './learnSource.js';
import { runStructured } from './learnAi.js';

const LEVEL_COLORS = ['#ff7a52', '#ffb27a', '#3fb8c0']; // root, level 1, level 2

const mapSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    centralTopic: { type: 'string' },
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', description: 'unique short id, e.g. "n1"' },
          label: { type: 'string' },
          level: { type: 'integer', description: '0 = central, 1 = main branch, 2 = detail' },
          parentId: { type: ['string', 'null'], description: 'id of the parent node, null for the central node' },
        },
        required: ['id', 'label', 'level', 'parentId'],
      },
    },
    edges: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          fromId: { type: 'string' },
          toId: { type: 'string' },
          label: { type: ['string', 'null'] },
        },
        required: ['fromId', 'toId', 'label'],
      },
    },
  },
  required: ['centralTopic', 'nodes', 'edges'],
};

export async function generateMindMap(userId, classId, { sourceType = null } = {}) {
  const cls = await getOwnedClass(userId, classId);
  const { text, sources } = await gatherClassContext(classId, sourceType);

  const system =
    `Create a mind map of the most important ideas in a student's "${cls.name}" class, using ONLY ` +
    `the material below. Produce a central topic, 3-5 main branches (level 1), and 2-3 details per ` +
    `branch (level 2). Give every node a unique id and set parentId correctly (central node parentId ` +
    `is null). Add an edge from each node to its parent.\n\nMaterial:\n"""\n${text}\n"""`;
  const data = await runStructured({
    feature: 'Mind map generation',
    system,
    user: 'Generate the mind map now.',
    schema: mapSchema,
  });

  const nodes = (Array.isArray(data.nodes) ? data.nodes : []).map((n) => ({
    id: String(n.id),
    label: n.label,
    level: Math.max(0, Math.min(2, n.level ?? 1)),
    parentId: n.parentId ? String(n.parentId) : null,
    color: LEVEL_COLORS[Math.max(0, Math.min(2, n.level ?? 1))],
  }));
  if (!nodes.length) throw new AppError(502, 'No mind map was generated. Try again.');
  const edges = (Array.isArray(data.edges) ? data.edges : []).map((e) => ({
    fromId: String(e.fromId),
    toId: String(e.toId),
    label: e.label || null,
  }));

  const title = data.centralTopic || cls.name;
  const { rows } = await query(
    `INSERT INTO mind_maps (class_id, user_id, title, topic, nodes, edges, generated_from)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7) RETURNING *`,
    [classId, userId, title, data.centralTopic || null, JSON.stringify(nodes), JSON.stringify(edges), sources],
  );
  const r = rows[0];
  return { mindmapId: r.id, centralTopic: r.topic, nodeCount: nodes.length };
}

export async function listClassMindMaps(userId, classId) {
  await getOwnedClass(userId, classId);
  const { rows } = await query(
    `SELECT id, title, topic, generated_at, jsonb_array_length(nodes) AS node_count
       FROM mind_maps WHERE class_id = $1 AND user_id = $2 ORDER BY generated_at DESC`,
    [classId, userId],
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    centralTopic: r.topic,
    nodeCount: Number(r.node_count),
    generatedAt: r.generated_at,
  }));
}

export async function getMindMap(userId, mindmapId) {
  const { rows } = await query('SELECT * FROM mind_maps WHERE id = $1 AND user_id = $2', [mindmapId, userId]);
  if (!rows[0]) throw AppError.notFound('Mind map not found');
  const r = rows[0];
  return {
    id: r.id,
    title: r.title,
    centralTopic: r.topic,
    nodes: r.nodes ?? [],
    edges: r.edges ?? [],
    generatedAt: r.generated_at,
  };
}
