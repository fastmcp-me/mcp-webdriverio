import { getBrowser } from './browser.tool';
import type { ToolCallback } from '@modelcontextprotocol/sdk/server/mcp';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types';
import type { ToolDefinition } from '../types/tool';
import { encode } from '@toon-format/toon';
import { z } from 'zod';

/**
 * Tool definition for get_accessibility
 */
export const getAccessibilityToolDefinition: ToolDefinition = {
  name: 'get_accessibility',
  description: 'gets accessibility tree snapshot with semantic information about page elements (roles, names, states). Browser-only - use when get_visible_elements does not return expected elements.',
  inputSchema: {
    limit: z.number().optional()
      .describe('Maximum number of nodes to return. Default: 100. Use 0 for unlimited.'),
    offset: z.number().optional()
      .describe('Number of nodes to skip (for pagination). Default: 0.'),
    roles: z.array(z.string()).optional()
      .describe('Filter to specific roles (e.g., ["button", "link", "textbox"]). Default: all roles.'),
    namedOnly: z.boolean().optional()
      .describe('Only return nodes with a name/label. Default: true. Filters out anonymous containers.'),
  },
};

/**
 * Flatten a hierarchical accessibility tree into a flat list
 * Uses uniform fields (all nodes have same keys) to enable tabular format
 * @param node - The accessibility node
 * @param result - Accumulator array
 */
function flattenAccessibilityTree(node: any, result: any[] = []): any[] {
  if (!node) return result;

  // Add current node (excluding root WebArea unless it has meaningful content)
  if (node.role !== 'WebArea' || node.name) {
    // Build object with ALL fields for uniform schema (enables tabular format)
    // Empty string '' used for missing values to keep schema consistent
    const entry: Record<string, any> = {
      // Primary identifiers (most useful)
      role: node.role || '',
      name: node.name || '',
      value: node.value ?? '',
      description: node.description || '',
      // Boolean states (empty string = not applicable/false)
      disabled: node.disabled ? 'true' : '',
      focused: node.focused ? 'true' : '',
      selected: node.selected ? 'true' : '',
      checked: node.checked === true ? 'true' : node.checked === false ? 'false' : node.checked === 'mixed' ? 'mixed' : '',
      expanded: node.expanded === true ? 'true' : node.expanded === false ? 'false' : '',
      pressed: node.pressed === true ? 'true' : node.pressed === false ? 'false' : node.pressed === 'mixed' ? 'mixed' : '',
      readonly: node.readonly ? 'true' : '',
      required: node.required ? 'true' : '',
      // Less common properties
      level: node.level ?? '',
      valuemin: node.valuemin ?? '',
      valuemax: node.valuemax ?? '',
      autocomplete: node.autocomplete || '',
      haspopup: node.haspopup || '',
      invalid: node.invalid ? 'true' : '',
      modal: node.modal ? 'true' : '',
      multiline: node.multiline ? 'true' : '',
      multiselectable: node.multiselectable ? 'true' : '',
      orientation: node.orientation || '',
      keyshortcuts: node.keyshortcuts || '',
      roledescription: node.roledescription || '',
      valuetext: node.valuetext || '',
    };

    result.push(entry);
  }

  // Recursively process children
  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      flattenAccessibilityTree(child, result);
    }
  }

  return result;
}

export const getAccessibilityTreeTool: ToolCallback = async (args: {
  limit?: number;
  offset?: number;
  roles?: string[];
  namedOnly?: boolean;
}): Promise<CallToolResult> => {
  try {
    const browser = getBrowser();

    // Check if this is a mobile session - accessibility tree is browser-only
    if (browser.isAndroid || browser.isIOS) {
      return {
        content: [{
          type: 'text',
          text: 'Error: get_accessibility is browser-only. For mobile apps, use get_visible_elements instead.',
        }],
      };
    }

    const { limit = 100, offset = 0, roles, namedOnly = true } = args || {};

    // Get Puppeteer instance for native accessibility API
    const puppeteer = await browser.getPuppeteer();
    const pages = await puppeteer.pages();

    if (pages.length === 0) {
      return {
        content: [{ type: 'text', text: 'No active pages found' }],
      };
    }

    const page = pages[0];

    // Get accessibility snapshot with interestingOnly filter
    const snapshot = await page.accessibility.snapshot({
      interestingOnly: true, // Filter to only interesting/semantic nodes
    });

    if (!snapshot) {
      return {
        content: [{ type: 'text', text: 'No accessibility tree available' }],
      };
    }

    // Flatten the hierarchical tree into a flat list
    let nodes = flattenAccessibilityTree(snapshot);

    // Filter to named nodes only (removes anonymous containers, StaticText duplicates)
    if (namedOnly) {
      nodes = nodes.filter(n => n.name && n.name.trim() !== '');
    }

    // Filter to specific roles if provided
    if (roles && roles.length > 0) {
      const roleSet = new Set(roles.map(r => r.toLowerCase()));
      nodes = nodes.filter(n => n.role && roleSet.has(n.role.toLowerCase()));
    }

    const total = nodes.length;

    // Apply pagination
    if (offset > 0) {
      nodes = nodes.slice(offset);
    }
    if (limit > 0) {
      nodes = nodes.slice(0, limit);
    }

    const result = {
      total,
      showing: nodes.length,
      hasMore: offset + nodes.length < total,
      nodes,
    };

    // Post-process: replace "" with bare commas for efficiency
    const toon = encode(result)
      .replace(/,""/g, ',')
      .replace(/"",/g, ',');

    return {
      content: [{ type: 'text', text: toon }],
    };
  } catch (e) {
    return {
      content: [{ type: 'text', text: `Error getting accessibility tree: ${e}` }],
    };
  }
};