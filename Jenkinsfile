// Builds one image from `master` and promotes it dev → stag → prod. Each
// environment must roll out and answer before the next one is touched, so a
// bad image stops at dev.

// Roll the image out to one environment, then wait until its gateway answers.
def promote(String ns, String host, String kubeconfigCred) {
    withEnv(["NAMESPACE=${ns}", "HOST=${host}"]) {
        withCredentials([file(credentialsId: kubeconfigCred, variable: 'KUBECONFIG')]) {
            sh '''
                K="kubectl --insecure-skip-tls-verify -n $NAMESPACE"
                $K set image "deploy/$DEPLOYMENT" "$DEPLOYMENT=$IMAGE:$TAG"
                $K rollout status "deploy/$DEPLOYMENT" --timeout=300s
            '''
        }
        // 401 = gateway up and enforcing auth; 503 for a few seconds while the ALB registers the pod.
        sh '''
            for i in $(seq 1 24); do
                CODE=$(curl -s -o /dev/null -w '%{http_code}' "https://$HOST/v1/models" || true)
                echo "https://$HOST/v1/models → $CODE"
                [ "$CODE" = 401 ] && exit 0
                sleep 5
            done
            exit 1
        '''
    }
}

pipeline {
    // Only Worker 1 has a route to the cluster APIs.
    agent { label 'Worker 1' }

    options {
        disableConcurrentBuilds()
        timeout(time: 45, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '20'))
    }

    environment {
        DOCKER_USER = credentials('dockerhub-username')
        DOCKER_PASS = credentials('dockerhub-password')
        IMAGE = 'quantumteknologi/qb-9router'
        DEPLOYMENT = 'qb-9router'
    }

    stages {
        stage('Resolve') {
            steps {
                script {
                    if (env.BRANCH_NAME != 'master') { error("Only master deploys; got ${env.BRANCH_NAME}") }
                    def day = sh(script: 'TZ=Asia/Jakarta date +%Y.%m.%d', returnStdout: true).trim()
                    env.TAG = "${day}-${env.GIT_COMMIT.substring(0, 8)}"
                    echo "${env.IMAGE}:${env.TAG} → dev → stag → prod"
                }
            }
        }

        stage('Build & Push') {
            steps {
                sh '''
                    echo "$DOCKER_PASS" | docker login -u "$DOCKER_USER" --password-stdin
                    DOCKER_BUILDKIT=1 docker build --pull --progress=plain -t "$IMAGE:$TAG" .
                    docker push "$IMAGE:$TAG"
                '''
            }
        }

        stage('Dev') {
            steps { script { promote('quantumbyte', '9router-dev.qtn.ai', 'kubeconfig-kubernet-matrix') } }
        }

        stage('Stag') {
            steps { script { promote('quantumbyte-stag', '9router-stag.quantumbyte.ai', 'kubernet-kubeconfig-stag-prod-qb') } }
        }

        stage('Prod') {
            steps { script { promote('quantumbyte', '9router.quantumbyte.ai', 'kubernet-kubeconfig-stag-prod-qb') } }
        }
    }

    post {
        always {
            sh 'docker image rm "$IMAGE:$TAG" >/dev/null 2>&1 || true'
        }
    }
}
