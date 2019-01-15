/*
 * Copyright 2018 Apple Inc.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 *    1. Redistributions of source code must retain the above copyright notice,
 *       this list of conditions and the following disclaimer.
 *
 *    2. Redistributions in binary form must reproduce the above copyright notice,
 *       this list of conditions and the following disclaimer in the documentation
 *       and/or other materials provided with the distribution.
 *
 *    3. Neither the name of the copyright holder nor the names of its
 *       contributors may be used to endorse or promote products derived from this
 *       software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

import { ArrayRefType } from "./ArrayRefType.mjs";
import { ArrayType } from "./ArrayType.mjs";
import { Assignment } from "./Assignment.mjs";
import { Block } from "./Block.mjs";
import { BoolLiteral } from "./BoolLiteral.mjs";
import { Break } from "./Break.mjs";
import { BuiltInSemantic } from "./BuiltInSemantic.mjs";
import { CallExpression } from "./CallExpression.mjs";
import { CommaExpression } from "./CommaExpression.mjs";
import { Continue } from "./Continue.mjs";
import { DereferenceExpression } from "./DereferenceExpression.mjs";
import { DoWhileLoop } from "./DoWhileLoop.mjs";
import { DotExpression } from "./DotExpression.mjs";
import { EnumMember } from "./EnumMember.mjs";
import { EnumType } from "./EnumType.mjs";
import { Field } from "./Field.mjs";
import { FloatLiteral } from "./FloatLiteral.mjs";
import { ForLoop } from "./ForLoop.mjs";
import { Func } from "./Func.mjs";
import { FuncDef } from "./FuncDef.mjs";
import { FuncNumThreadsAttribute } from "./FuncNumThreadsAttribute.mjs";
import { FuncParameter } from "./FuncParameter.mjs";
import { IfStatement } from "./IfStatement.mjs";
import { IndexExpression } from "./IndexExpression.mjs";
import { IntLiteral } from "./IntLiteral.mjs";
import { Lexer } from "./Lexer.mjs";
import { LexerToken } from "./LexerToken.mjs";
import { LogicalExpression } from "./LogicalExpression.mjs";
import { LogicalNot } from "./LogicalNot.mjs";
import { MakeArrayRefExpression } from "./MakeArrayRefExpression.mjs";
import { MakePtrExpression } from "./MakePtrExpression.mjs";
import { MatrixType } from "./MatrixType.mjs";
import { NativeFunc } from "./NativeFunc.mjs";
import { NativeType } from "./NativeType.mjs";
import { NullLiteral } from "./NullLiteral.mjs";
import { PtrType } from "./PtrType.mjs";
import { ReadModifyWriteExpression } from "./ReadModifyWriteExpression.mjs";
import { ResourceSemantic } from "./ResourceSemantic.mjs";
import { Return } from "./Return.mjs";
import { SpecializationConstantSemantic } from "./SpecializationConstantSemantic.mjs";
import { StageInOutSemantic } from "./StageInOutSemantic.mjs";
import { StructType } from "./StructType.mjs";
import { SwitchCase } from "./SwitchCase.mjs";
import { SwitchStatement } from "./SwitchStatement.mjs";
import { TernaryExpression } from "./TernaryExpression.mjs";
import { TrapStatement } from "./TrapStatement.mjs";
import { TypeDef } from "./TypeDef.mjs";
import { TypeRef } from "./TypeRef.mjs";
import { UintLiteral } from "./UintLiteral.mjs";
import { VariableDecl } from "./VariableDecl.mjs";
import { VariableRef } from "./VariableRef.mjs";
import { VectorType } from "./VectorType.mjs";
import { WSyntaxError } from "./WSyntaxError.mjs";
import { WhileLoop } from "./WhileLoop.mjs";
import { addressSpaces } from "./AddressSpace.mjs";

export function parse(program, origin, originKind, lineNumberOffset, text)
{
    let lexer = new Lexer(origin, originKind, lineNumberOffset, text);

    // The hardest part of dealing with C-like languages is parsing variable declaration statements.
    // Let's consider if this happens in WHLSL. Here are the valid statements in WHLSL that being with an
    // identifier, if we assume that any expression can be a standalone statement.
    //
    //     x;
    //     x <binop> y;
    //     x < y;
    //     x < y > z;
    //     x = y;
    //     x.f = y;
    //     \exp = y;
    //     x[42] = y;
    //     x();
    //     x<y>();
    //     x y;
    //     x<y> z;
    //     device x[] y;
    //     x[42] y;
    //     device x^ y;
    //     thread x^^ y;
    //     x^thread^thread y;
    //     x^device^thread y;
    //
    // This has two problem areas:
    //
    //     - x<y>z can parse two different ways (as (x < y) > z or x<y> z).
    //     - x[42] could become either an assignment or a variable declaration.
    //     - x<y> could become either an assignment or a variable declaration.
    //
    // We solve the first problem by forbidding expressions as statements. The lack of function
    // pointers means that we can still allow function call statements - unlike in C, those cannot
    // have arbitrary expressions as the callee. The remaining two problems are solved by
    // backtracking. In all other respects, this is a simple recursive descent parser.

    function fail(error)
    {
        return new WSyntaxError(lexer.originString, error);
    }

    function backtrackingScope(callback)
    {
        let state = lexer.state;
        let maybeError = callback();
        if (maybeError instanceof WSyntaxError) {
            lexer.state = state;
            return null;
        } else
            return maybeError;
    }

    function testScope(callback)
    {
        let state = lexer.state;
        let maybeError = callback();
        lexer.state = state;
        return !(maybeError instanceof WSyntaxError);
    }

    function genericConsume(callback, explanation)
    {
        let token = lexer.next();
        if (!token)
            return fail("Unexpected end of file");
        if (!callback(token))
            return fail("Unexpected token: " + token.text + "; expected: " + explanation);
        return token;
    }

    function consume(...texts)
    {
        return genericConsume(token => texts.includes(token.text), texts);
    }

    function consumeKind(kind)
    {
        return genericConsume(token => token.kind == kind, kind);
    }

    function assertNext(...texts)
    {
        let maybeError = consume(...texts);
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        lexer.push(maybeError);
    }

    function genericTest(callback)
    {
        let token = lexer.peek();
        if (token && callback(token))
            return token;
        return null;
    }

    function test(...texts)
    {
        return genericTest(token => texts.includes(token.text));
    }

    function testKind(kind)
    {
        return genericTest(token => token.kind == kind);
    }

    function tryConsume(...texts)
    {
        let result = test(...texts);
        if (result)
            lexer.next();
        return result;
    }

    function tryConsumeKind(kind)
    {
        let result = testKind(kind);
        if (result)
            lexer.next();
        return result;
    }

    function consumeEndOfTypeArgs()
    {
        let rightShift = tryConsume(">>");
        if (rightShift)
            lexer.push(new LexerToken(lexer, rightShift, rightShift.index, rightShift.kind, ">"));
        else {
            let maybeError = consume(">");
            if (maybeError instanceof WSyntaxError)
                return maybeError;
        }
    }

    function parseTerm()
    {
        let token;
        if (token = tryConsume("null"))
            return new NullLiteral(token);
        if (token = tryConsumeKind("identifier"))
            return new VariableRef(token, token.text);
        if (token = tryConsumeKind("intLiteral")) {
            let intVersion = (+token.text) | 0;
            if ("" + intVersion !== token.text)
                return fail("Integer literal is not an integer: " + token.text);
            return new IntLiteral(token, intVersion);
        }
        if (token = tryConsumeKind("uintLiteral")) {
            let uintVersion = token.text.substr(0, token.text.length - 1) >>> 0;
            if (uintVersion + "u" !== token.text)
                return fail("Integer literal is not 32-bit unsigned integer: " + token.text);
            return new UintLiteral(token, uintVersion);
        }
        if ((token = tryConsumeKind("intHexLiteral"))
            || (token = tryConsumeKind("uintHexLiteral"))) {
            let hexString = token.text.substr(2);
            if (token.kind == "uintHexLiteral")
                hexString = hexString.substr(0, hexString.length - 1);
            if (!hexString.length)
                throw new Error("Bad hex literal: " + token);
            let intVersion = parseInt(hexString, 16);
            if (token.kind == "intHexLiteral")
                intVersion = intVersion | 0;
            else
                intVersion = intVersion >>> 0;
            if (intVersion.toString(16) !== hexString)
                return fail("Hex integer literal is not an integer: " + token.text);
            if (token.kind == "intHexLiteral")
                return new IntLiteral(token, intVersion);
            return new UintLiteral(token, intVersion >>> 0);
        }
        if (token = tryConsumeKind("floatLiteral")) {
            let text = token.text;
            let f = token.text.endsWith("f");
            if (f)
                text = text.substring(0, text.length - 1);
            let value = parseFloat(text);
            return new FloatLiteral(token, Math.fround(value));
        }
        if (token = tryConsume("true", "false"))
            return new BoolLiteral(token, token.text == "true");
        // FIXME: Need support for other literals too.
        let maybeError = consume("(");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        let result = parseExpression();
        if (result instanceof WSyntaxError)
            return result;
        maybeError = consume(")");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        return result;
    }

    function parseConstexpr()
    {
        let token;
        if (token = tryConsume("-")) {
            let term = parseTerm();
            if (term instanceof WSyntaxError)
                return term;
            return new CallExpression(token, "operator" + token.text, [term]);
        }
        let left = parseTerm();
        if (left instanceof WSyntaxError)
            return left;
        if (token = tryConsume(".")) {
            let maybeError = consumeKind("identifier")
            if (maybeError instanceof WSyntaxError)
                return maybeError;
            left = new DotExpression(token, left, maybeError.text);
        }
        return left;
    }

    function parseTypeArguments()
    {
        if (!test("<"))
            return [];

        let result = [];
        let maybeError = consume("<");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        while (!test(">")) {
            // It's possible for a constexpr or type can syntactically overlap in the single
            // identifier case. Let's consider the possibilities:
            //
            //     T          could be type or constexpr
            //     T[]        only type
            //     T[42]      only type (constexpr cannot do indexing)
            //     42         only constexpr
            //
            // In the future we'll allow constexprs to do more things, and then we'll still have
            // the problem that something of the form T[1][2][3]... can either be a type or a
            // constexpr, and we can figure out in the checker which it is.
            let typeRef = backtrackingScope(() => {
                let result = consumeKind("identifier");
                if (result instanceof WSyntaxError)
                    return result;
                let maybeError = assertNext(",", ">", ">>");
                if (maybeError instanceof WSyntaxError)
                    return maybeError;
                return new TypeRef(result, result.text);
            });
            if (typeRef)
                result.push(typeRef);
            else {
                let constexpr = backtrackingScope(() => {
                    let result = parseConstexpr();
                    if (result instanceof WSyntaxError)
                        return result;
                    let maybeError = assertNext(",", ">", ">>");
                    if (maybeError instanceof WSyntaxError)
                        return maybeError;
                    return result;
                });
                if (constexpr)
                    result.push(constexpr);
                else {
                    let type = parseType();
                    if (type instanceof WSyntaxError)
                        return type;
                    result.push(type);
                }
            }
            if (!tryConsume(","))
                break;
        }
        maybeError = consumeEndOfTypeArgs();
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        return result;
    }

    function parseType()
    {
        let token;
        let addressSpace;
        let addressSpaceConsumed = false;
        if (token = tryConsume(...addressSpaces))
            addressSpace = token.text;

        let name = consumeKind("identifier");
        if (name instanceof WSyntaxError)
            return name;
        let typeArguments = parseTypeArguments();
        if (typeArguments instanceof WSyntaxError)
            return typeArguments;

        function parseAggregateType()
        {
            let token = consume("*", "[");
            if (token instanceof WSyntaxError)
                return token;
            if (token.text == "*") {
                let localAddressSpace;
                if (addressSpace)
                    localAddressSpace = addressSpace;
                else {
                    localAddressSpace = consume(...addressSpaces);
                    if (localAddressSpace instanceof WSyntaxError)
                        return localAddressSpace;
                    localAddressSpace = localAddressSpace.text;
                }
                return type => new PtrType(token, localAddressSpace, type);
            }

            if (tryConsume("]")) {
                let localAddressSpace;
                if (addressSpace)
                    localAddressSpace = addressSpace;
                else {
                    localAddressSpace = consume(...addressSpaces);
                    if (localAddressSpace instanceof WSyntaxError)
                        return localAddressSpace;
                    localAddressSpace = localAddressSpace.text;
                }
                return type => new ArrayRefType(token, localAddressSpace, type);
            }

            const lengthLiteral = consumeKind("intLiteral");
            if (lengthLiteral instanceof WSyntaxError)
                return lengthLiteral;
            let intVersion = (+lengthLiteral.text) | 0;
            if ("" + intVersion !== lengthLiteral.text)
                return fail("Integer literal is not an integer: " + token.text);
            let maybeError = consume("]");
            if (maybeError instanceof WSyntaxError)
                return maybeError;
            return type => new ArrayType(token, type, new IntLiteral(token, intVersion));
        }

        const typeConstructorStack = [ ];

        if (addressSpace) {
            let firstAggregateType = parseAggregateType();
            if (firstAggregateType instanceof WSyntaxError)
                return firstAggregateType;
            typeConstructorStack.unshift(firstAggregateType);
        }

        while (true) {
            let aggregateType = backtrackingScope(parseAggregateType);
            if (!aggregateType)
                break;
            typeConstructorStack.unshift(aggregateType);
        }

        let type = new TypeRef(name, name.text, typeArguments);
        for (let constructor of typeConstructorStack)
            type = constructor(type);

        return type;
    }

    function parseTypeDef()
    {
        let origin = consume("typedef");
        if (origin instanceof WSyntaxError)
            return origin;
        let maybeError = consumeKind("identifier");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        let name = maybeError.text;
        maybeError = consume("=");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        let type = parseType();
        if (type instanceof WSyntaxError)
            return type;
        maybeError = consume(";");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        return new TypeDef(origin, name, type);
    }

    function genericParseLeft(texts, nextParser, constructor)
    {
        let left = nextParser();
        if (left instanceof WSyntaxError)
            return left;
        let token;
        while (token = tryConsume(...texts)) {
            let next = nextParser();
            if (next instanceof WSyntaxError)
                return next;
            left = constructor(token, left, next);
        }
        return left;
    }

    function parseLeftOperatorCall(texts, nextParser)
    {
        return genericParseLeft(
            texts, nextParser,
            (token, left, right) =>
                new CallExpression(token, "operator" + token.text, [left, right]));
    }

    function parseCallExpression()
    {
        let name = consumeKind("identifier");
        if (name instanceof WSyntaxError)
            return name;
        let maybeError = consume("(");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        let argumentList = [];
        while (!test(")")) {
            let argument = parsePossibleAssignment();
            if (argument instanceof WSyntaxError)
                return argument;
            argumentList.push(argument);
            if (!tryConsume(","))
                break;
        }
        maybeError = consume(")");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        return new CallExpression(origin, name.text, argumentList);
    }

    function isCallExpression()
    {
        return testScope(() => {
                let maybeError = consumeKind("identifier");
                if (maybeError instanceof WSyntaxError)
                    return maybeError;
                maybeError = consume("(");
                if (maybeError instanceof WSyntaxError)
                    return maybeError;
            }) || testScope(() => {
                let type = parseType();
                if (type instanceof WSyntaxError)
                    return type;
                let maybeError = consume("(");
                if (maybeError instanceof WSyntaxError)
                    return maybeError;
            });
    }

    function emitIncrement(token, old, extraArg)
    {
        let args = [old];
        if (extraArg)
            args.push(extraArg);

        let name = "operator" + token.text;
        if (/=$/.test(name))
            name = RegExp.leftContext;

        if (name == "operator")
            throw new Error("Invalid name: " + name);

        return new CallExpression(token, name, args);
    }

    function finishParsingPostIncrement(token, left)
    {
        let readModifyWrite = new ReadModifyWriteExpression(token, left);
        readModifyWrite.newValueExp = emitIncrement(token, readModifyWrite.oldValueRef());
        readModifyWrite.resultExp = readModifyWrite.oldValueRef();
        return readModifyWrite;
    }

    function parseSuffixOperator(left, acceptableOperators)
    {
        let token;
        while (token = tryConsume(...acceptableOperators)) {
            switch (token.text) {
            case "++":
            case "--":
                return finishParsingPostIncrement(token, left);
            case ".":
            case "->": {
                if (token.text == "->")
                    left = new DereferenceExpression(token, left);
                let maybeError = consumeKind("identifier");
                if (maybeError instanceof WSyntaxError)
                    return maybeError;
                left = new DotExpression(token, left, maybeError.text);
                break;
            }
            case "[": {
                let index = parseExpression();
                if (index instanceof WSyntaxError)
                    return index;
                let maybeError = consume("]");
                if (maybeError instanceof WSyntaxError)
                    return maybeError;
                left = new IndexExpression(token, left, index);
                break;
            }
            default:
                throw new Error("Bad token: " + token);
            }
        }
        return left;
    }

    function parsePossibleSuffix()
    {
        let acceptableOperators = ["++", "--", ".", "->", "["];
        let limitedOperators = [".", "->", "["];
        let left;
        if (isCallExpression()) {
            left = parseCallExpression();
            if (left instanceof WSyntaxError)
                return left;
            acceptableOperators = limitedOperators;
        } else {
            left = parseTerm();
            if (left instanceof WSyntaxError)
                return left;
        }

        return parseSuffixOperator(left, acceptableOperators);
    }

    function finishParsingPreIncrement(token, left, extraArg)
    {
        let readModifyWrite = new ReadModifyWriteExpression(token, left);
        readModifyWrite.newValueExp = emitIncrement(token, readModifyWrite.oldValueRef(), extraArg);
        readModifyWrite.resultExp = readModifyWrite.newValueRef();
        return readModifyWrite;
    }

    function parsePreIncrement()
    {
        let token = consume("++", "--");
        if (token instanceof WSyntaxError)
            return token;
        let left = parsePossiblePrefix();
        if (left instanceof WSyntaxError)
            return left;
        return finishParsingPreIncrement(token, left);
    }

    function parsePossiblePrefix()
    {
        let token;
        if (test("++", "--"))
            return parsePreIncrement();
        if (token = tryConsume("+", "-", "~")) {
            let possiblePrefix = parsePossiblePrefix();
            if (possiblePrefix instanceof WSyntaxError)
                return WSyntaxError;
            return new CallExpression(token, "operator" + token.text, [possiblePrefix]);
        } if (token = tryConsume("*")) {
            let possiblePrefix = parsePossiblePrefix();
            if (possiblePrefix instanceof WSyntaxError)
                return WSyntaxError;
            return new DereferenceExpression(token, possiblePrefix);
        } if (token = tryConsume("&")) {
            let possiblePrefix = parsePossiblePrefix();
            if (possiblePrefix instanceof WSyntaxError)
                return WSyntaxError;
            return new MakePtrExpression(token, possiblePrefix);
        } if (token = tryConsume("@")) {
            let possiblePrefix = parsePossiblePrefix();
            if (possiblePrefix instanceof WSyntaxError)
                return WSyntaxError;
            return new MakeArrayRefExpression(token, possiblePrefix);
        } if (token = tryConsume("!")) {
            let remainder = parsePossiblePrefix();
            if (remainder instanceof WSyntaxError)
                return remainder;
            return new LogicalNot(token, new CallExpression(remainder.origin, "bool", [remainder]));
        }
        return parsePossibleSuffix();
    }

    function parsePossibleProduct()
    {
        return parseLeftOperatorCall(["*", "/", "%"], parsePossiblePrefix);
    }

    function parsePossibleSum()
    {
        return parseLeftOperatorCall(["+", "-"], parsePossibleProduct);
    }

    function parsePossibleShift()
    {
        return parseLeftOperatorCall(["<<", ">>"], parsePossibleSum);
    }

    function parsePossibleRelationalInequality()
    {
        return parseLeftOperatorCall(["<", ">", "<=", ">="], parsePossibleShift);
    }

    function parsePossibleRelationalEquality()
    {
        return genericParseLeft(
            ["==", "!="], parsePossibleRelationalInequality,
            (token, left, right) => {
                let result = new CallExpression(token, "operator==", [left, right]);
                if (token.text == "!=")
                    result = new LogicalNot(token, result);
                return result;
            });
    }

    function parsePossibleBitwiseAnd()
    {
        return parseLeftOperatorCall(["&"], parsePossibleRelationalEquality);
    }

    function parsePossibleBitwiseXor()
    {
        return parseLeftOperatorCall(["^"], parsePossibleBitwiseAnd);
    }

    function parsePossibleBitwiseOr()
    {
        return parseLeftOperatorCall(["|"], parsePossibleBitwiseXor);
    }

    function parseLeftLogicalExpression(texts, nextParser)
    {
        return genericParseLeft(
            texts, nextParser,
            (token, left, right) => new LogicalExpression(token, token.text, new CallExpression(left.origin, "bool", [left]), new CallExpression(right.origin, "bool", [right])));
    }

    function parsePossibleLogicalAnd()
    {
        return parseLeftLogicalExpression(["&&"], parsePossibleBitwiseOr);
    }

    function parsePossibleLogicalOr()
    {
        return parseLeftLogicalExpression(["||"], parsePossibleLogicalAnd);
    }

    function parsePossibleTernaryConditional()
    {
        let predicate = parsePossibleLogicalOr();
        if (predicate instanceof WSyntaxError)
            return predicate;
        let operator = tryConsume("?");
        if (!operator)
            return predicate;
        let bodyExpression = parsePossibleAssignment();
        if (bodyExpression instanceof WSyntaxError)
            return bodyExpression;
        let maybeError = consume(":");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        let elseExpression = parsePossibleAssignment();
        if (elseExpression instanceof WSyntaxError)
            return elseExpression;
        return new TernaryExpression(operator, predicate, bodyExpression, elseExpression);
    }

    function parsePossibleAssignment(mode)
    {
        let lhs = parsePossibleTernaryConditional();
        if (lhs instanceof WSyntaxError)
            return lhs;
        let operator = tryConsume("=", "+=", "-=", "*=", "/=", "%=", "^=", "|=", "&=");
        if (!operator) {
            if (mode == "required")
                return fail("Expected assignment: " + lexer._text.substring(lexer._index));
            return lhs;
        }
        if (operator.text == "=") {
            let innerAssignment = parsePossibleAssignment();
            if (innerAssignment instanceof WSyntaxError)
                return innerAssignment;
            return new Assignment(operator, lhs, innerAssignment);
        }
        let innerAssignment = parsePossibleAssignment();
        if (innerAssignment instanceof WSyntaxError)
            return innerAssignment;
        return finishParsingPreIncrement(operator, lhs, innerAssignment);
    }

    function parseAssignment()
    {
        return parsePossibleAssignment("required");
    }

    function parsePostIncrement()
    {
        let term = parseTerm();
        if (term instanceof WSyntaxError)
            return term;
        let left = parseSuffixOperator(term, ".", "->", "[");
        if (left instanceof WSyntaxError)
            return left;
        let token = consume("++", "--");
        if (token instanceof WSyntaxError)
            return token;
        return finishParsingPostIncrement(token, left);
    }

    function parseEffectfulExpression()
    {
        if (isCallExpression())
            return parseCallExpression();
        let preIncrement = backtrackingScope(parsePreIncrement);
        if (preIncrement)
            return preIncrement;
        let postIncrement = backtrackingScope(parsePostIncrement);
        if (postIncrement)
            return postIncrement;
        return parseAssignment();
    }

    function genericParseCommaExpression(finalExpressionParser)
    {
        let list = [];
        let origin = lexer.peek();
        if (!origin)
            return fail("Unexpected end of file");
        for (;;) {
            let effectfulExpression = backtrackingScope(() => {
                let effectfulExpression = parseEffectfulExpression();
                if (effectfulExpression instanceof WSyntaxError)
                    return effectfulExpression;
                let maybeError = consume(",");
                if (maybeError instanceof WSyntaxError)
                    return maybeError;
                return effectfulExpression;
            });
            if (!effectfulExpression) {
                let final = finalExpressionParser();
                list.push(final);
                break;
            }
            list.push(effectfulExpression);
        }
        if (!list.length)
            throw new Error("Length should never be zero");
        if (list.length == 1)
            return list[0];
        return new CommaExpression(origin, list);
    }

    function parseCommaExpression()
    {
        return genericParseCommaExpression(parsePossibleAssignment);
    }

    function parseExpression()
    {
        return parseCommaExpression();
    }

    function parseEffectfulStatement()
    {
        let result = genericParseCommaExpression(parseEffectfulExpression);
        if (result instanceof WSyntaxError)
            return result;
        let maybeError = consume(";");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        return result;
    }

    function parseReturn()
    {
        let origin = consume("return");
        if (origin instanceof WSyntaxError)
            return origin;
        if (tryConsume(";"))
            return new Return(origin, null);
        let expression = parseExpression();
        if (expression instanceof WSyntaxError)
            return expression;
        let maybeError = consume(";");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        return new Return(origin, expression);
    }

    function parseBreak()
    {
        let origin = consume("break");
        if (origin instanceof WSyntaxError)
            return origin;
        let maybeError = consume(";");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        return new Break(origin);
    }

    function parseContinue()
    {
        let origin = consume("continue");
        if (origin instanceof WSyntaxError)
            return origin;
        let maybeError = consume(";");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        return new Continue(origin);
    }

    function parseIfStatement()
    {
        let origin = consume("if");
        if (origin instanceof WSyntaxError)
            return origin;
        let maybeError = consume("(");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        let conditional = parseExpression();
        if (conditional instanceof WSyntaxError)
            return conditional;
        maybeError = consume(")");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        let body = parseStatement();
        if (body instanceof WSyntaxError)
            return body;
        let elseBody;
        if (tryConsume("else")) {
            elseBody = parseStatement();
            if (elseBody instanceof WSyntaxError)
                return elseBody;
        }
        return new IfStatement(origin, new CallExpression(conditional.origin, "bool", [conditional]), body, elseBody);
    }

    function parseWhile()
    {
        let origin = consume("while");
        if (origin instanceof WSyntaxError)
            return origin;
        let maybeError = consume("(");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        let conditional = parseExpression();
        if (conditional instanceof WSyntaxError)
            return conditional;
        maybeError = consume(")");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        let body = parseStatement();
        if (body instanceof WSyntaxError)
            return body;
        return new WhileLoop(origin, new CallExpression(conditional.origin, "bool", [conditional]), body);
    }

    function parseFor()
    {
        let origin = consume("for");
        if (origin instanceof WSyntaxError)
            return origin;
        let maybeError = consume("(");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        let initialization;
        if (tryConsume(";"))
            initialization = undefined;
        else {
            initialization = backtrackingScope(parseVariableDecls);
            if (!initialization) {
                initialization = parseEffectfulStatement();
                if (initialization instanceof WSyntaxError)
                    return initialization;
            }
        }
        let condition = tryConsume(";");
        if (condition)
            condition = undefined;
        else {
            condition = parseExpression();
            if (condition instanceof WSyntaxError)
                return condition;
            maybeError = consume(";");
            if (maybeError instanceof WSyntaxError)
                return maybeError;
            condition = new CallExpression(condition.origin, "bool", [condition]);
        }
        let increment;
        if (tryConsume(")"))
            increment = undefined;
        else {
            increment = parseExpression();
            if (increment instanceof WSyntaxError)
                return increment;
            maybeError = consume(")");
            if (maybeError instanceof WSyntaxError)
                return maybeError;
        }
        let body = parseStatement();
        if (body instanceof WSyntaxError)
            return body;
        return new ForLoop(origin, initialization, condition, increment, body);
    }

    function parseDo()
    {
        let origin = consume("do");
        if (origin instanceof WSyntaxError)
            return origin;
        let body = parseStatement();
        if (body instanceof WSyntaxError)
            return body;
        let maybeError = consume("while");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        maybeError = consume("(");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        let conditional = parseExpression();
        if (conditional instanceof WSyntaxError)
            return conditional;
        maybeError = consume(")");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        return new DoWhileLoop(origin, body, new CallExpression(conditional.origin, "bool", [conditional]));
    }

    function parseVariableDecls()
    {
        let type = parseType();
        if (type instanceof WSyntaxError)
            return type;
        let list = [];
        do {
            let name = consumeKind("identifier");
            if (name instanceof WSyntaxError)
                return name;
            let initializer = tryConsume("=") ? parseExpression() : null;
            if (initializer instanceof WSyntaxError)
                return initializer;
            list.push(new VariableDecl(name, name.text, type, initializer));
            let maybeError = consume(",", ";");
            if (maybeError instanceof WSyntaxError)
                return maybeError;
            if (maybeError.text != ",")
                break;
        } while (true);
        return new CommaExpression(type.origin, list);
    }

    function parseSwitchCase()
    {
        let token = consume("default", "case");
        if (token instanceof WSyntaxError)
            return token;
        let value;
        if (token.text == "case") {
            value = parseConstexpr();
            if (value instanceof WSyntaxError)
                return value;
        }
        let maybeError = consume(":");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        let body = parseBlockBody("}", "default", "case");
        if (body instanceof WSyntaxError)
            return body;
        return new SwitchCase(token, value, body);
    }

    function parseSwitchStatement()
    {
        let origin = consume("switch");
        if (origin instanceof WSyntaxError)
            return origin;
        let maybeError = consume("(");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        let value = parseExpression();
        if (value instanceof WSyntaxError)
            return value;
        maybeError = consume(")");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        maybeError = consume("{");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        let result = new SwitchStatement(origin, value);
        while (!tryConsume("}")) {
            let switchCase = parseSwitchCase();
            if (switchCase instanceof WSyntaxError)
                return switchCase;
            result.add(switchCase);
        }
        return result;
    }

    function parseStatement()
    {
        let token = lexer.peek();
        if (token.text == ";") {
            lexer.next();
            return null;
        }
        if (token.text == "return")
            return parseReturn();
        if (token.text == "break")
            return parseBreak();
        if (token.text == "continue")
            return parseContinue();
        if (token.text == "while")
            return parseWhile();
        if (token.text == "do")
            return parseDo();
        if (token.text == "for")
            return parseFor();
        if (token.text == "if")
            return parseIfStatement();
        if (token.text == "switch")
            return parseSwitchStatement();
        if (token.text == "trap") {
            let origin = consume("trap");
            if (origin instanceof WSyntaxError)
                return origin;
            consume(";");
            return new TrapStatement(origin);
        }
        if (token.text == "{")
            return parseBlock();
        let variableDecl = backtrackingScope(parseVariableDecls);
        if (variableDecl)
            return variableDecl;
        return parseEffectfulStatement();
    }

    function parseBlockBody(...terminators)
    {
        let block = new Block(origin);
        while (!test(...terminators)) {
            let statement = parseStatement();
            if (statement instanceof WSyntaxError)
                return statement;
            if (statement)
                block.add(statement);
        }
        return block;
    }

    function parseBlock()
    {
        let origin = consume("{");
        if (origin instanceof WSyntaxError)
            return origin;
        let block = parseBlockBody("}");
        if (block instanceof WSyntaxError)
            return block;
        let maybeError = consume("}");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        return block;
    }

    function parseParameter()
    {
        let type = parseType();
        if (type instanceof WSyntaxError)
            return type;
        let name = tryConsumeKind("identifier");
        let semantic = null;
        if (tryConsume(":")) {
            semantic = parseSemantic();
            if (semantic instanceof WSyntaxError)
                return semantic;
        }
        return new FuncParameter(type.origin, name ? name.text : null, type, semantic);
    }

    function parseParameters()
    {
        let maybeError = consume("(");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        let parameters = [];
        while (!test(")")) {
            let parameter = parseParameter();
            if (parameter instanceof WSyntaxError)
                return parameter;
            parameters.push(parameter);
            if (!tryConsume(","))
                break;
        }
        maybeError = consume(")");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        return parameters;
    }

    function parseFuncName()
    {
        if (tryConsume("operator")) {
            let token = consume("+", "-", "*", "/", "%", "^", "&", "|", "<", ">", "<=", ">=", "==", "++", "--", ".", "~", "<<", ">>", "[");
            if (token instanceof WSyntaxError)
                return token;
            if (token.text == "&") {
                if (tryConsume("[")) {
                    let maybeError = consume("]");
                    if (maybeError instanceof WSyntaxError)
                        return maybeError;
                    return "operator&[]";
                }
                if (tryConsume(".")) {
                    let maybeError = consumeKind("identifier");
                    if (maybeError instanceof WSyntaxError)
                        return maybeError;
                    return "operator&." + maybeError.text;
                }
                return "operator&";
            }
            if (token.text == ".") {
                let maybeError = consumeKind("identifier");
                if (maybeError instanceof WSyntaxError)
                    return maybeError;
                let result = "operator." + maybeError.text;
                if (tryConsume("="))
                    result += "=";
                return result;
            }
            if (token.text == "[") {
                let maybeError = consume("]");
                if (maybeError instanceof WSyntaxError)
                    return maybeError;
                let result = "operator[]";
                if (tryConsume("="))
                    result += "=";
                return result;
            }
            return "operator" + token.text;
        }
        let maybeError = consumeKind("identifier");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        return maybeError.text;
    }

    function parseAttributeBlock()
    {
        let maybeError = consume("[");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        maybeError = consume("numthreads");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        maybeError = consume("(");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        let xDimension = consumeKind("intLiteral");
        if (xDimension instanceof WSyntaxError)
            return xDimension;
        let xDimensionUintVersion = xDimension.text >>> 0;
        if (xDimensionUintVersion.toString() !== xDimension.text)
            return fail("Numthreads X attribute is not 32-bit unsigned integer: " + xDimension.text);
        maybeError = consume(",");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        let yDimension = consumeKind("intLiteral");
        if (yDimension instanceof WSyntaxError)
            return yDimension;
        let yDimensionUintVersion = yDimension.text >>> 0;
        if (yDimensionUintVersion.toString() !== yDimension.text)
            return fail("Numthreads Y attribute is not 32-bit unsigned integer: " + yDimension.text);
        maybeError = consume(",");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        let zDimension = consumeKind("intLiteral");
        if (zDimension instanceof WSyntaxError)
            return zDimension;
        let zDimensionUintVersion = zDimension.text >>> 0;
        if (zDimensionUintVersion.toString() !== zDimension.text)
            return fail("Numthreads Z attribute is not 32-bit unsigned integer: " + zDimension.text);
        maybeError = consume(")");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        maybeError = consume("]");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        return [new FuncNumThreadsAttribute(xDimensionUintVersion, yDimensionUintVersion, zDimensionUintVersion)];
    }

    function parseFuncDecl()
    {
        let origin;
        let returnType;
        let name;
        let isCast;
        let shaderType = null;
        let semantic = null;
        let attributeBlock = null;
        let operatorToken = tryConsume("operator");
        if (operatorToken) {
            origin = operatorToken;
            returnType = parseType();
            if (returnType instanceof WSyntaxError)
                return returnType;
            name = "operator cast";
            isCast = true;
        } else {
            if (test("[")) {
                attributeBlock = parseAttributeBlock();
                if (attributeBlock instanceof WSyntaxError)
                    return attributeBlock;
                shaderType = consume("compute");
                if (shaderType instanceof WSyntaxError)
                    return shaderType;
            } else
                shaderType = tryConsume("vertex", "fragment", "test");
            returnType = parseType();
            if (returnType instanceof WSyntaxError)
                return returnType;
            if (shaderType) {
                origin = shaderType;
                shaderType = shaderType.text;
            } else
                origin = returnType.origin;
            name = parseFuncName();
            if (name instanceof WSyntaxError)
                return name;
            isCast = false;
        }
        let parameters = parseParameters();
        if (parameters instanceof WSyntaxError)
            return parameters;
        if (tryConsume(":")) {
            semantic = parseSemantic();
            if (semantic instanceof WSyntaxError)
                return semantic;
        }
        return new Func(origin, name, returnType, parameters, isCast, shaderType, semantic, attributeBlock);
    }

    function parseFuncDef()
    {
        let func = parseFuncDecl();
        if (func instanceof WSyntaxError)
            return func;
        let body = parseBlock();
        if (body instanceof WSyntaxError)
            return body;
        return new FuncDef(func.origin, func.name, func.returnType, func.parameters, body, func.isCast, func.shaderType, func.semantic, func.attributeBlock);
    }

    function parseStageInOutSemantic()
    {
        let origin = consume("attribute");
        if (origin instanceof WSyntaxError)
            return origin;
        let maybeError = consume("(");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        let index = consumeKind("intLiteral");
        if (index instanceof WSyntaxError)
            return index;
        let uintVersion = index.text >>> 0;
        if (uintVersion.toString() !== index.text)
            return fail("Semantic  is not 32-bit unsigned integer: " + index.text);
        maybeError = consume(")");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        return new StageInOutSemantic(origin, uintVersion);
    }

    function parseResourceSemantic()
    {
        let origin = consume("register");
        if (origin instanceof WSyntaxError)
            return origin;
        let maybeError = consume("(");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        let mode = consumeKind("identifier");
        if (mode instanceof WSyntaxError)
            return mode;
        mode = mode.text;
        if (mode[0] != "u" && mode[0] != "t" && mode[0] != "b" && mode[0] != "s")
            return fail("register needs to be either u, t, b, or s");
        let indexText = mode.substring(1);
        mode = mode[0];
        let uintVersion = indexText >>> 0;
        if (uintVersion.toString() !== indexText)
            return fail("Register index is not 32-bit unsigned integer: " + indexText);
        let space = 0;
        if (tryConsume(",")) {
            space = consumeKind("identifier");
            if (space instanceof WSyntaxError)
                return space;
            space = space.text;
            if (space.substring(0, "space".length) != "space")
                return fail("Second argument to register() needs to be of the form \"space0\"");
            let spaceText = space.substring("space".length);
            let uintVersion = spaceText >>> 0;
            if (uintVersion.toString() !== spaceText)
                return fail("Register index is not 32-bit unsigned integer: " + spaceText);
            space = uintVersion;
        }
        maybeError = consume(")");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        return new ResourceSemantic(origin, mode, uintVersion, space);
    }

    function parseSpecializationConstantSemantic()
    {
        let origin = consume("specialized");
        if (origin instanceof WSyntaxError)
            return origin;
        return new SpecializationConstantSemantic(origin);
    }

    function parseBuiltInSemantic()
    {
        let origin = tryConsume("SV_InstanceID",
                                "SV_VertexID",
                                "PSIZE",
                                "SV_Position",
                                "SV_IsFrontFace",
                                "SV_SampleIndex",
                                "SV_InnerCoverage",
                                "SV_Depth",
                                "SV_Coverage",
                                "SV_DispatchThreadID",
                                "SV_GroupID",
                                "SV_GroupIndex",
                                "SV_GroupThreadID");
        if (origin)
            return new BuiltInSemantic(origin, origin.text);
        origin = consumeKind("identifier");
        if (origin instanceof WSyntaxError)
            return origin;
        if (origin.text.substring(0, "SV_Target".length) == "SV_Target") {
            let indexString = origin.text.substring("SV_Target".length);
            let uintVersion = indexString >>> 0;
            if (uintVersion.toString() !== indexString)
                return fail("Semantic is not 32-bit unsigned integer: " + indexString);
            return new BuiltInSemantic(origin, "SV_Target", uintVersion);
        } else
            return fail(`Unknown semantic: ${origin.text}`);
    }

    function parseSemantic()
    {
        if (test("attribute"))
            return parseStageInOutSemantic();
        else if (test("register"))
            return parseResourceSemantic();
        else if (test("specialized"))
            return parseSpecializationConstantSemantic();
        else
            return parseBuiltInSemantic();
    }

    function parseField()
    {
        let type = parseType();
        if (type instanceof WSyntaxError)
            return type;
        let name = consumeKind("identifier");
        if (name instanceof WSyntaxError)
            return name;
        let semantic = null;
        if (tryConsume(":")) {
            semantic = parseSemantic();
            if (semantic instanceof WSyntaxError)
                return semantic;
        }
        let maybeError = consume(";");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        return new Field(name, name.text, type, semantic);
    }

    function parseStructType()
    {
        let origin = consume("struct");
        if (origin instanceof WSyntaxError)
            return origin;
        let name = consumeKind("identifier");
        if (name instanceof WSyntaxError)
            return name;
        let result = new StructType(origin, name.text);
        let maybeError = consume("{");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        while (!tryConsume("}")) {
            let field = parseField();
            if (field instanceof WSyntaxError)
                return field;
            result.add(field);
        }
        return result;
    }

    function parseNativeFunc(stage = null)
    {
        let func = parseFuncDecl();
        if (func instanceof WSyntaxError)
            return func;
        if (func.attributeBlock)
            return fail("Native function must not have attribute block");
        let maybeError = consume(";");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        if (func.shaderType || func.semantic)
            return fail("Native functions can't be entry points or have semantics.");
        return new NativeFunc(func.origin, func.name, func.returnType, func.parameters, func.isCast, stage);
    }

    function parseNative()
    {
        let origin = consume("native");
        if (origin instanceof WSyntaxError)
            return origin;
        if (tryConsume("typedef")) {
            let name = consumeKind("identifier");
            if (name instanceof WSyntaxError)
                return name;
            let args = parseTypeArguments();
            if (args instanceof WSyntaxError)
                return args;
            let maybeError = consume(";");
            if (maybeError instanceof WSyntaxError)
                return maybeError;
            if (name.text == "vector")
                return new VectorType(origin, name.text, args);
            if (name.text == "matrix")
                return new MatrixType(origin, name.text, args);
            return new NativeType(origin, name.text, args);
        }
        let stage = tryConsume("vertex", "fragment", "compute");
        if (stage)
            stage = stage.text;
        return parseNativeFunc(stage);
    }

    function parseEnumMember()
    {
        let name = consumeKind("identifier");
        if (name instanceof WSyntaxError)
            return name;
        let value = null;
        if (tryConsume("=")) {
            value = parseConstexpr();
            if (value instanceof WSyntaxError)
                return value;
        }
        return new EnumMember(name, name.text, value);
    }

    function parseEnumType()
    {
        let maybeError = consume("enum");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        let name = consumeKind("identifier");
        if (name instanceof WSyntaxError)
            return name;
        let baseType;
        if (tryConsume(":")) {
            baseType = parseType();
            if (baseType instanceof WSyntaxError)
                return baseType;
        } else
            baseType = new TypeRef(name, "int");
        maybeError = consume("{");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        let result = new EnumType(name, name.text, baseType);
        while (!test("}")) {
            let enumMember = parseEnumMember();
            if (enumMember instanceof WSyntaxError)
                return enumMember;
            result.add(enumMember);
            if (!tryConsume(","))
                break;
        }
        maybeError = consume("}");
        if (maybeError instanceof WSyntaxError)
            return maybeError;
        return result;
    }

    for (;;) {
        let token = lexer.peek();
        if (!token)
            return;
        if (token.text == ";")
            lexer.next();
        else if (token.text == "typedef") {
            let typeDef = parseTypeDef();
            if (typeDef instanceof WSyntaxError)
                throw typeDef;
            program.add(typeDef);
        } else if (originKind == "native" && token.text == "native") {
            let native = parseNative();
            if (native instanceof WSyntaxError)
                throw native;
            program.add(native);
        } else if (token.text == "struct") {
            let struct = parseStructType();
            if (struct instanceof WSyntaxError)
                throw struct;
            program.add(struct);
        } else if (token.text == "enum") {
            let enumType = parseEnumType();
            if (enumType instanceof WSyntaxError)
                throw enumType;
            program.add(enumType);
        } else {
            let funcDef = parseFuncDef();
            if (funcDef instanceof WSyntaxError)
                throw funcDef;
            program.add(funcDef);
        }
    }
}

export { parse as default };
