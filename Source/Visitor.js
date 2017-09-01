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

class Visitor {
    visitProgram(node)
    {
        for (let statement of node.topLevelStatements)
            statement.visit(this);
    }
    
    visitFunc(node)
    {
        node.returnType.visit(this);
        for (let typeParameter of node.typeParameters)
            typeParameter.visit(this);
        for (let parameter of node.parameters)
            parameter.visit(this);
    }
    
    visitFuncParameter(node)
    {
        node.type.visit(this);
    }
    
    visitFuncDef(node)
    {
        this.visitFunc(node);
        node.body.visit(this);
    }
    
    visitNativeFunc(node)
    {
        this.visitFunc(node);
    }
    
    visitNativeFuncInstance(node)
    {
        node.func.visit(this);
        this.visitFunc(node);
    }
    
    visitBlock(node)
    {
        for (let statement of node.statements)
            statement.visit(this);
    }
    
    visitCommaExpression(node)
    {
        for (let expression of node.list)
            expression.visit(this);
    }
    
    visitProtocolRef(node)
    {
    }
    
    visitProtocolDecl(node)
    {
        for (let signature of node.signatures)
            signature.visit(this);
    }
    
    visitTypeRef(node)
    {
        for (let typeArgument of node.typeArguments)
            typeArgument.visit(this);
    }
    
    visitNativeType(node)
    {
        for (let typeParameter of node.typeParameters)
            typeParameter.visit(this);
    }
    
    visitTypeDef(node)
    {
        for (let typeParameter of node.typeParameters)
            typeParameter.visit(this);
        node.type.visit(this);
    }
    
    visitStructType(node)
    {
        for (let typeParameter of node.typeParameters)
            typeParameter.visit(this);
        for (let field of node.fields)
            field.visit(this);
    }
    
    visitTypeVariable(node)
    {
        if (node.protocol)
            node.protocol.visit(this);
    }
    
    visitConstexprTypeParameter(node)
    {
        node.type.visit(this);
    }
    
    visitField(node)
    {
        node.type.visit(this);
    }
    
    visitElementalType(node)
    {
        node.elementType.visit(this);
    }
    
    visitReferenceType(node)
    {
        this.visitElementalType(node);
    }
    
    visitPtrType(node)
    {
        this.visitReferenceType(node);
    }
    
    visitArrayRefType(node)
    {
        this.visitReferenceType(node);
    }
    
    visitArrayType(node)
    {
        this.visitElementalType(node);
        node.numElements.visit(this);
    }
    
    visitVariableDecl(node)
    {
        node.type.visit(this);
        if (node.initializer)
            node.initializer.visit(this);
    }
    
    visitAssignment(node)
    {
        node.lhs.visit(this);
        node.rhs.visit(this);
    }
    
    visitDereferenceExpression(node)
    {
        node.ptr.visit(this);
    }
    
    visitMakePtrExpression(node)
    {
        node.lValue.visit(this);
    }
    
    visitVariableRef(node)
    {
    }
    
    visitReturn(node)
    {
        if (node.value)
            node.value.visit(this);
    }
    
    visitIntLiteral(node)
    {
    }
    
    visitUintLiteral(node)
    {
    }
    
    visitCallExpression(node)
    {
        for (let typeArgument of node.typeArguments)
            typeArgument.visit(this);
        for (let argument of node.argumentList)
            argument.visit(this);
        let actualTypeArguments = node.actualTypeArguments;
        if (actualTypeArguments) {
            for (let argument of actualTypeArguments)
                argument.visit(this);
        }
    }
    
    visitFunctionLikeBlock(node)
    {
        for (let argument of node.argumentList)
            argument.visit(this);
        for (let parameter of node.parameters)
            parameter.visit(this);
        node.body.visit(this);
    }
}
