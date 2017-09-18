/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. 
 */
"use strict";

class Checker extends Visitor {
    constructor(program)
    {
        super();
        this._program = program;
        this._currentStatement = null;
    }
    
    visitProgram(node)
    {
        for (let statement of node.topLevelStatements) {
            this._currentStatement = statement;
            statement.visit(this);
        }
    }
    
    visitProtocolDecl(node)
    {
        for (let signature of node.signatures) {
            let set = new Set();
            function consider(thing)
            {
                if (thing.isUnifiable)
                    set.add(thing);
            }
            class NoticeTypeVariable extends Visitor {
                visitTypeRef(node)
                {
                    consider(node.type);
                }
                visitVariableRef(node)
                {
                    consider(node.variable);
                }
            }
            let noticeTypeVariable = new NoticeTypeVariable();
            for (let parameterType of signature.parameterTypes)
                parameterType.visit(noticeTypeVariable);
            for (let typeParameter of signature.typeParameters) {
                if (!set.has(typeParameter))
                    throw WTypeError(typeParameter.origin.originString, "Type parameter to protocol signature not inferrable from value parameters");
            }
            if (!set.has(node.typeVariable))
                throw new WTypeError(signature.origin.originString, "Protocol's type variable (" + node.name + ") not mentioned in signature: " + signature);
        }
    }
    
    _checkTypeArguments(origin, typeParameters, typeArguments)
    {
        for (let i = 0; i < typeParameters.length; ++i) {
            let argumentIsType = typeArguments[i] instanceof Type;
            let result = typeArguments[i].visit(this);
            if (argumentIsType) {
                let result = typeArguments[i].inherits(typeParameters[i].protocol);
                if (!result.result)
                    throw new WTypeError(origin.originString, "Type argument does not inherit protocol: " + result.reason);
            } else {
                if (!result.equalsWithCommit(typeParameters[i].type))
                    throw new WTypeError(origin.originString, "Wrong type for constexpr");
            }
        }
    }
    
    visitTypeRef(node)
    {
        if (!node.type)
            throw new Error("Type reference without a type in checker: " + node + " at " + node.origin);
        this._checkTypeArguments(node.origin, node.type.typeParameters, node.typeArguments);
    }
    
    visitReferenceType(node)
    {
        node.elementType.visit(this);
        
        if (node.addressSpace == "thread")
            return;
        
        if (!node.elementType.instantiatedType.isPrimitive)
            throw new WTypeError(node.origin.originString, "Illegal pointer to non-primitive type: " + node.elementType + " (instantiated to " + node.elementType.instantiatedType + ")");
    }
    
    visitArrayType(node)
    {
        node.elementType.visit(this);
        
        if (!node.numElements.isConstexpr)
            throw new WTypeError(node.origin.originString, "Array length must be constexpr");
        
        let type = node.numElements.visit(this);
        
        if (!type.equalsWithCommit(this._program.intrinsics.uint32))
            throw new WTypeError(node.origin.originString, "Array length must be a uint32");
    }
    
    visitVariableDecl(node)
    {
        node.type.visit(this);
        if (node.initializer) {
            let lhsType = node.type;
            let rhsType = node.initializer.visit(this);
            if (!lhsType.equalsWithCommit(rhsType))
                throw new WTypeError(node.origin.originString, "Type mismatch in variable initialization: " + lhsType + " versus " + rhsType);
        }
    }
    
    visitAssignment(node)
    {
        if (!node.lhs.isLValue)
            throw new WTypeError(node.origin.originString, "LHS of assignment is not an LValue: " + node.lhs);
        let lhsType = node.lhs.visit(this);
        let rhsType = node.rhs.visit(this);
        if (!lhsType.equalsWithCommit(rhsType))
            throw new WTypeError(node.origin.originString, "Type mismatch in assignment: " + lhsType + " versus " + rhsType);
        node.type = lhsType;
        return lhsType;
    }
    
    visitDereferenceExpression(node)
    {
        let type = node.ptr.visit(this).unifyNode;
        if (!type.isPtr)
            throw new WTypeError(node.origin.originString, "Type passed to dereference is not a pointer: " + type);
        node.type = type.elementType;
        node.addressSpace = type.addressSpace;
        return node.type;
    }
    
    visitMakePtrExpression(node)
    {
        if (!node.lValue.isLValue)
            throw new WTypeError(node.origin.originString, "Operand to & is not an LValue: " + node.lValue);
        
        let elementType = node.lValue.visit(this).unifyNode;
        
        return new PtrType(node.origin, node.lValue.addressSpace, elementType);
    }
    
    visitMakeArrayRefExpression(node)
    {
        let elementType = node.lValue.visit(this).unifyNode;
        if (elementType instanceof PtrType) {
            node.becomeConvertPtrToArrayRefExpression();
            return new ArrayRefType(node.origin, elementType.addressSpace, elementType.elementType);
        }
        
        if (!node.lValue.isLValue)
            throw new WTypeError(node.origin.originString, "Operand to @ is not an LValue: " + node.lValue);
        
        if (elementType instanceof ArrayRefType)
            throw new WTypeError(node.origin.originStrimg, "Operand to @ is an array reference: " + elementType);
        
        if (elementType instanceof ArrayType) {
            node.numElements = elementType.numElements;
            elementType = elementType.elementType;
        } else
            node.numElements = UintLiteral.withType(node.origin, 1, this._program.intrinsics.uint32);
            
        return new ArrayRefType(node.origin, node.lValue.addressSpace, elementType);
    }
    
    visitConvertToArrayRefExpression(node)
    {
        throw new Error("Should not exist yet.");
    }
    
    visitDotExpression(node)
    {
        let structType = node.struct.visit(this).unifyNode;
        
        node.structType = structType.visit(new AutoWrapper());
        
        let underlyingStruct = structType;
        
        if (structType instanceof TypeRef)
            underlyingStruct = underlyingStruct.type;
        
        if (!(underlyingStruct instanceof StructType))
            throw new WTypeError(node.origin.originString, "Operand to dot expression is not a struct type: " + structType);
        
        if (structType instanceof TypeRef) 
            underlyingStruct = underlyingStruct.instantiate(structType.typeArguments, "shallow");
        
        let field = underlyingStruct.fieldByName(node.fieldName);
        if (!field)
            throw new WTypeError(node.origin.originString, "Field " + node.fieldName + " not found in " + structType);
        return field.type;
    }
    
    visitLetExpression(node)
    {
        node.type = node.argument.visit(this);
        if (!node.type)
            throw new Error("Did not get type for node: " + node.argument);
        return node.body.visit(this);
    }
    
    visitVariableRef(node)
    {
        if (!node.variable.type)
            throw new Error("Variable has no type: " + node.variable);
        return node.variable.type;
    }
    
    visitReturn(node)
    {
        if (node.value) {
            let resultType = node.value.visit(this);
            if (!resultType)
                throw new Error("Null result type from " + node.value);
            if (!node.func.returnType.equalsWithCommit(resultType))
                throw new WTypeError(node.origin.originString, "Trying to return " + resultType + " in a function that returns " + node.func.returnType);
            return;
        }
        
        if (!node.func.returnType.equalsWithCommit(this._program.intrinsics.void))
            throw new WTypeError(node.origin.originString, "Non-void function must return a value");
    }
    
    visitGenericLiteral(node)
    {
        return node.type;
    }
    
    visitNullLiteral(node)
    {
        return node.type;
    }
    
    visitBoolLiteral(node)
    {
        return this._program.intrinsics.bool;
    }

    _requireBool(expression)
    {
        let type = expression.visit(this);
        if (!type)
            throw new Error("Expression has no type, but should be bool: " + expression);
        if (!type.equals(this._program.intrinsics.bool))
            throw new WError("Expression isn't a bool: " + expression);
    }

    visitLogicalNot(node)
    {
        this._requireBool(node.operand);
        return this._program.intrinsics.bool;
    }

    visitLogicalExpression(node)
    {
        this._requireBool(node.left);
        this._requireBool(node.right);
        return this._program.intrinsics.bool;
    }

    visitIfStatement(node)
    {
        this._requireBool(node.conditional);
        node.body.visit(this);
        if (node.elseBody)
            node.elseBody.visit(this);
    }

    visitWhileLoop(node)
    {
        this._requireBool(node.conditional);
        node.body.visit(this);
    }

    visitDoWhileLoop(node)
    {
        node.body.visit(this);
        this._requireBool(node.conditional);
    }

    visitForLoop(node)
    {
        if (node.initialization)
            node.initialization.visit(this);
        if (node.condition)
            this._requireBool(node.condition);
        if (node.increment)
            node.increment.visit(this);
        node.body.visit(this);
    }
    
    visitCommaExpression(node)
    {
        let result = null;
        for (let expression of node.list)
            result = expression.visit(this);
        return result;
    }

    visitCallExpression(node)
    {
        let typeArgumentTypes = node.typeArguments.map(typeArgument => typeArgument.visit(this));
        let argumentTypes = node.argumentList.map(argument => {
            let newArgument = argument.visit(this);
            if (!newArgument)
                throw new Error("visitor returned null for " + argument);
            return newArgument.visit(new AutoWrapper());
        });
        
        // Here we need to handle the cases where operator&[] is called with a type that isn't sufficiently
        // referencey.
        if (node.name == "operator&[]") {
            let argType = argumentTypes[0].unifyNode;
            if (argType instanceof PtrType)
                throw new WTypeError(node.origin.originString, "Pointer subscript is not valid");
            
            if (argType instanceof ArrayType) {
                node.argumentList[0] = new MakeArrayRefExpression(node.origin, node.argumentList[0]);
                node.argumentList[0].numElements = argType.numElements;
                argumentTypes[0] = new ArrayRefType(node.origin, "thread", argType.elementType);
            } else if (!(argType instanceof ArrayRefType)) {
                node.argumentList[0] = new MakePtrExpression(node.origin, node.argumentList[0]);
                argumentTypes[0] = new PtrType(node.origin, "thread", argumentTypes[0]);
            }
        }
        
        node.argumentTypes = argumentTypes;
        if (node.returnType)
            node.returnType.visit(this);
        
        let overload = null;
        let failures = [];
        for (let typeParameter of this._currentStatement.typeParameters) {
            if (!(typeParameter instanceof TypeVariable))
                continue;
            if (!typeParameter.protocol)
                continue;
            let signatures =
                typeParameter.protocol.protocolDecl.signaturesByNameWithTypeVariable(node.name, typeParameter);
            if (!signatures)
                continue;
            overload = resolveOverloadImpl(signatures, node.typeArguments, argumentTypes, node.returnType);
            if (overload.func)
                break;
            failures.push(...overload.failures);
            overload = null;
        }
        if (!overload) {
            overload = resolveOverloadImpl(
                node.possibleOverloads, node.typeArguments, argumentTypes, node.returnType);
            if (!overload.func) {
                failures.push(...overload.failures);
                let message = "Did not find function for call with ";
                if (node.typeArguments.length)
                    message += "type arguments <" + node.typeArguments + "> and ";
                message += "argument types (" + argumentTypes + ")";
                if (node.returnType)
                    message +=" and return type " + node.returnType;
                if (failures.length)
                    message += ", but considered:\n" + failures.join("\n")
                throw new WTypeError(node.origin.originString, message);
            }
        }
        for (let i = 0; i < typeArgumentTypes.length; ++i) {
            let typeArgumentType = typeArgumentTypes[i];
            let typeParameter = overload.func.typeParameters[i];
            if (!(typeParameter instanceof ConstexprTypeParameter))
                continue;
            if (!typeParameter.type.equalsWithCommit(typeArgumentType))
                throw new Error("At " + node.origin.originString + " constexpr type argument and parameter types not equal: argument = " + typeArgumentType + ", parameter = " + typeParameter.type);
        }
        for (let i = 0; i < argumentTypes.length; ++i) {
            let argumentType = argumentTypes[i];
            let parameterType = overload.func.parameters[i].type.substituteToUnification(
                overload.func.typeParameters, overload.unificationContext);
            let result = argumentType.equalsWithCommit(parameterType);
            if (!result)
                throw new Error("At " + node.origin.originString + " argument and parameter types not equal after type argument substitution: argument = " + argumentType + ", parameter = " + parameterType);
        }
        return node.resolve(overload);
    }
}

