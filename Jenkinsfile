// Builds the image and rolls it out: branch `stag` → quantumbyte-stag, `master` → quantumbyte.
pipeline {
    // Only Worker 1 has a route to the cluster API.
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
                    def targets = [
                        stag  : [env: 'stag', ns: 'quantumbyte-stag', host: '9router-stag.quantumbyte.ai'],
                        master: [env: 'prod', ns: 'quantumbyte',      host: '9router.quantumbyte.ai'],
                    ]
                    def t = targets[env.BRANCH_NAME]
                    if (!t) { error("No environment for branch ${env.BRANCH_NAME}") }
                    def day = sh(script: 'TZ=Asia/Jakarta date +%Y.%m.%d', returnStdout: true).trim()
                    env.NAMESPACE = t.ns
                    env.HOST = t.host
                    env.TAG = "${t.env}-${day}-${env.GIT_COMMIT.substring(0, 8)}"
                    echo "${env.BRANCH_NAME} → ${env.NAMESPACE} as ${env.IMAGE}:${env.TAG}"
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

        stage('Deploy') {
            steps {
                withCredentials([file(credentialsId: 'kubernet-kubeconfig-stag-prod-qb', variable: 'KUBECONFIG')]) {
                    sh '''
                        K="kubectl --insecure-skip-tls-verify -n $NAMESPACE"
                        $K set image "deploy/$DEPLOYMENT" "$DEPLOYMENT=$IMAGE:$TAG"
                        $K rollout status "deploy/$DEPLOYMENT" --timeout=300s
                    '''
                }
            }
        }

        stage('Smoke') {
            steps {
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
    }

    post {
        always {
            sh 'docker image rm "$IMAGE:$TAG" >/dev/null 2>&1 || true'
        }
    }
}
