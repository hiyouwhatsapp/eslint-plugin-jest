/*
 * This implementation is adapted from eslint-plugin-jasmine.
 * MIT license, Remco Haszing.
 */

import {
  ASTUtils,
  AST_NODE_TYPES,
  type TSESLint,
  type TSESTree,
} from '@typescript-eslint/utils';
import {
  type FunctionExpression,
  createRule,
  getNodeName,
  isFunction,
  isTypeOfJestFnCall,
} from './utils';

/**
 * Checks if node names returned by getNodeName matches any of the given star patterns
 * Pattern examples:
 *   request.*.expect
 *   request.**.expect
 *   request.**.expect*
 */
function matchesAssertFunctionName(
  nodeName: string,
  patterns: readonly string[],
): boolean {
  return patterns.some(p =>
    new RegExp(
      `^${p
        .split('.')
        .map(x => {
          if (x === '**') {
            return '[a-z\\d\\.]*';
          }

          return x.replace(/\*/gu, '[a-z\\d]*');
        })
        .join('\\.')}(\\.|$)`,
      'ui',
    ).test(nodeName),
  );
}

function getLastStatement(fn: FunctionExpression): TSESTree.Node | null {
  if (fn.body.type === AST_NODE_TYPES.BlockStatement) {
    if (fn.body.body.length === 0) {
      return null;
    }

    const lastStatement = fn.body.body[fn.body.body.length - 1];

    if (lastStatement.type === AST_NODE_TYPES.ExpressionStatement) {
      return lastStatement.expression;
    }

    return lastStatement;
  }

  return fn.body;
}

function isNonEmptyArrayLiteral(node: TSESTree.Expression | null): boolean {
  return (
    node?.type === AST_NODE_TYPES.ArrayExpression &&
    node.elements.some(
      element => element?.type !== AST_NODE_TYPES.SpreadElement,
    )
  );
}

function hasNonEmptyArray(
  loop: TSESTree.ForOfStatement,
  scope: TSESLint.Scope.Scope,
): boolean {
  const { right } = loop;

  if (right.type !== AST_NODE_TYPES.Identifier) {
    return isNonEmptyArrayLiteral(right);
  }

  const variable = ASTUtils.findVariable(scope, right);

  if (!variable) {
    return false;
  }

  const [definition] = variable.defs;

  return (
    definition?.type === 'Variable' &&
    definition.parent.kind === 'const' &&
    definition.parent.parent === loop.parent &&
    definition.node.id.type === AST_NODE_TYPES.Identifier &&
    isNonEmptyArrayLiteral(definition.node.init) &&
    // Other references could mutate the array or let it escape.
    variable.references.every(
      reference => reference.init || reference.identifier === right,
    )
  );
}

export default createRule<
  [
    Partial<{
      assertFunctionNames: readonly string[];
      additionalTestBlockFunctions: readonly string[];
    }>,
  ],
  'mustEndWithExpect'
>({
  name: __filename,
  meta: {
    docs: {
      description: 'Prefer having the last statement in a test be an assertion',
    },
    messages: {
      mustEndWithExpect: 'Tests should end with an assertion',
    },
    schema: [
      {
        type: 'object',
        properties: {
          assertFunctionNames: {
            type: 'array',
            items: { type: 'string' },
          },
          additionalTestBlockFunctions: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        additionalProperties: false,
      },
    ],
    type: 'suggestion',
  },
  defaultOptions: [
    {
      assertFunctionNames: ['expect'],
      additionalTestBlockFunctions: [],
    },
  ],
  create(
    context,
    [{ assertFunctionNames = ['expect'], additionalTestBlockFunctions = [] }],
  ) {
    return {
      CallExpression(node) {
        const name = getNodeName(node.callee) ?? '';

        if (
          !isTypeOfJestFnCall(node, context, ['test']) &&
          !additionalTestBlockFunctions.includes(name)
        ) {
          return;
        }

        if (node.arguments.length < 2 || !isFunction(node.arguments[1])) {
          return;
        }

        let lastStatement = getLastStatement(node.arguments[1]);

        if (
          lastStatement?.type === AST_NODE_TYPES.ForOfStatement &&
          hasNonEmptyArray(
            lastStatement,
            context.sourceCode.getScope(lastStatement.right),
          )
        ) {
          const { body } = lastStatement;
          const statement =
            body.type === AST_NODE_TYPES.BlockStatement &&
            body.body.length === 1
              ? body.body[0]
              : body;

          if (statement.type === AST_NODE_TYPES.ExpressionStatement) {
            lastStatement = statement.expression;
          }
        }

        if (lastStatement?.type === AST_NODE_TYPES.AwaitExpression) {
          lastStatement = lastStatement.argument;
        }

        if (
          lastStatement?.type === AST_NODE_TYPES.CallExpression &&
          (isTypeOfJestFnCall(lastStatement, context, ['expect']) ||
            matchesAssertFunctionName(
              getNodeName(lastStatement.callee)!,
              assertFunctionNames,
            ))
        ) {
          return;
        }

        context.report({
          messageId: 'mustEndWithExpect',
          node: node.callee,
        });
      },
    };
  },
});
